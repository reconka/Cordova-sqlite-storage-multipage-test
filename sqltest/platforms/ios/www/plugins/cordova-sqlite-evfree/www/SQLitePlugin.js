cordova.define("cordova-sqlite-evfree.SQLitePlugin", function(require, exports, module) { 
/*
License for this version: GPL v3 (http://www.gnu.org/licenses/gpl.txt) or commercial license.
Contact for commercial license: info@litehelpers.net
 */

(function() {
  var DB_STATE_INIT, DB_STATE_OPEN, MAX_SQL_CHUNK, READ_ONLY_REGEX, SQLiteFactory, SQLitePlugin, SQLitePluginTransaction, argsArray, dblocations, newSQLError, nextTick, resulturiencoding, root, txLocks, useflatjson;

  root = this;

  READ_ONLY_REGEX = /^\s*(?:drop|delete|insert|update|create)\s/i;

  DB_STATE_INIT = "INIT";

  DB_STATE_OPEN = "OPEN";


  /*
  OPTIONAL: Transaction SQL chunking
  MAX_SQL_CHUNK is adjustable, set to 0 (or -1) to disable chunking
   */

  MAX_SQL_CHUNK = 0;

  txLocks = {};

  useflatjson = false;

  resulturiencoding = false;

  newSQLError = function(error, code) {
    var sqlError;
    sqlError = error;
    if (!code) {
      code = 0;
    }
    if (!sqlError) {
      sqlError = new Error("a plugin had an error but provided no response");
      sqlError.code = code;
    }
    if (typeof sqlError === "string") {
      sqlError = new Error(error);
      sqlError.code = code;
    }
    if (!sqlError.code && sqlError.message) {
      sqlError.code = code;
    }
    if (!sqlError.code && !sqlError.message) {
      sqlError = new Error("an unknown error was returned: " + JSON.stringify(sqlError));
      sqlError.code = code;
    }
    return sqlError;
  };

  nextTick = window.setImmediate || function(fun) {
    window.setTimeout(fun, 0);
  };


  /*
    Utility that avoids leaking the arguments object. See
    https://www.npmjs.org/package/argsarray
   */

  argsArray = function(fun) {
    return function() {
      var args, i, len;
      len = arguments.length;
      if (len) {
        args = [];
        i = -1;
        while (++i < len) {
          args[i] = arguments[i];
        }
        return fun.call(this, args);
      } else {
        return fun.call(this, []);
      }
    };
  };

  SQLitePlugin = function(openargs, openSuccess, openError) {
    var dbname;
    if (!(openargs && openargs['name'])) {
      throw newSQLError("Cannot create a SQLitePlugin db instance without a db name");
    }
    dbname = openargs.name;
    if (typeof dbname !== 'string') {
      throw newSQLError('sqlite plugin database name must be a string');
    }
    this.openargs = openargs;
    this.dbname = dbname;
    this.openSuccess = openSuccess;
    this.openError = openError;
    this.openSuccess || (this.openSuccess = function() {
      console.log("DB opened: " + dbname);
    });
    this.openError || (this.openError = function(e) {
      console.log(e.message);
    });
    this.open(this.openSuccess, this.openError);
  };

  SQLitePlugin.prototype.databaseFeatures = {
    isSQLitePluginDatabase: true
  };

  SQLitePlugin.prototype.openDBs = {};

  SQLitePlugin.prototype.addTransaction = function(t) {
    if (!txLocks[this.dbname]) {
      txLocks[this.dbname] = {
        queue: [],
        inProgress: false
      };
    }
    txLocks[this.dbname].queue.push(t);
    if (this.dbname in this.openDBs && this.openDBs[this.dbname] !== DB_STATE_INIT) {
      this.startNextTransaction();
    } else {
      if (this.dbname in this.openDBs) {
        console.log('new transaction is waiting for open operation');
      } else {
        console.log('database is closed, new transaction is [stuck] waiting until db is opened again!');
      }
    }
  };

  SQLitePlugin.prototype.beginTransaction = function(error) {
    var myfn, mytx;
    if (!this.openDBs[this.dbname]) {
      throw newSQLError('database not open');
    }
    myfn = function(tx) {};
    mytx = new SQLitePluginTransaction(this, myfn, error, null, false, false);
    mytx.canPause = true;
    mytx.addStatement("BEGIN", [], null, function(tx, err) {
      throw newSQLError("unable to begin transaction: " + err.message, err.code);
    });
    mytx.txlock = true;
    this.addTransaction(mytx);
    return mytx;
  };

  SQLitePlugin.prototype.transaction = function(fn, error, success) {
    if (!this.openDBs[this.dbname]) {
      error(newSQLError('database not open'));
      return;
    }
    this.addTransaction(new SQLitePluginTransaction(this, fn, error, success, true, false));
  };

  SQLitePlugin.prototype.readTransaction = function(fn, error, success) {
    if (!this.openDBs[this.dbname]) {
      error(newSQLError('database not open'));
      return;
    }
    this.addTransaction(new SQLitePluginTransaction(this, fn, error, success, false, true));
  };

  SQLitePlugin.prototype.startNextTransaction = function() {
    var self;
    self = this;
    nextTick((function(_this) {
      return function() {
        var txLock;
        if (!(_this.dbname in _this.openDBs) || _this.openDBs[_this.dbname] !== DB_STATE_OPEN) {
          console.log('cannot start next transaction: database not open');
          return;
        }
        txLock = txLocks[self.dbname];
        if (!txLock) {
          console.log('cannot start next transaction: database connection is lost');
          return;
        } else if (txLock.queue.length > 0 && !txLock.inProgress) {
          txLock.inProgress = true;
          txLock.queue.shift().start();
        }
      };
    })(this));
  };

  SQLitePlugin.prototype.abortAllPendingTransactions = function() {
    var l, len1, ref, tx, txLock;
    txLock = txLocks[this.dbname];
    if (!!txLock && txLock.queue.length > 0) {
      ref = txLock.queue;
      for (l = 0, len1 = ref.length; l < len1; l++) {
        tx = ref[l];
        tx.abortFromQ(newSQLError('Invalid database handle'));
      }
      txLock.queue = [];
      txLock.inProgress = false;
    }
  };

  SQLitePlugin.prototype.open = function(success, error) {
    var openerrorcb, opensuccesscb;
    if (this.dbname in this.openDBs) {
      console.log('database already open: ' + this.dbname);
      nextTick((function(_this) {
        return function() {
          success(_this);
        };
      })(this));
    } else {
      console.log('OPEN database: ' + this.dbname);
      opensuccesscb = (function(_this) {
        return function(a1) {
          var txLock;
          console.log('OPEN database: ' + _this.dbname + ' OK');
          if (!!a1 && (a1 === 'a1' || a1 === 'a1i')) {
            console.log('Detected Android/iOS version with flat JSON interface');
            useflatjson = true;
            if (a1 === 'a1i') {
              console.log('with result uri encoding');
              resulturiencoding = true;
            }
          }
          if (!_this.openDBs[_this.dbname]) {
            console.log('database was closed during open operation');
          }
          if (_this.dbname in _this.openDBs) {
            _this.openDBs[_this.dbname] = DB_STATE_OPEN;
          }
          if (!!success) {
            success(_this);
          }
          txLock = txLocks[_this.dbname];
          if (!!txLock && txLock.queue.length > 0 && !txLock.inProgress) {
            _this.startNextTransaction();
          }
        };
      })(this);
      openerrorcb = (function(_this) {
        return function() {
          console.log('OPEN database: ' + _this.dbname + ' failed, aborting any pending transactions');
          if (!!error) {
            error(newSQLError('Could not open database'));
          }
          delete _this.openDBs[_this.dbname];
          _this.abortAllPendingTransactions();
        };
      })(this);
      this.openDBs[this.dbname] = DB_STATE_INIT;
      cordova.exec(opensuccesscb, openerrorcb, "SQLitePlugin", "open", [this.openargs]);
    }
  };

  SQLitePlugin.prototype.close = function(success, error) {
    if (this.dbname in this.openDBs) {
      if (txLocks[this.dbname] && txLocks[this.dbname].inProgress) {
        console.log('cannot close: transaction is in progress');
        error(newSQLError('database cannot be closed while a transaction is in progress'));
        return;
      }
      console.log('CLOSE database: ' + this.dbname);
      delete this.openDBs[this.dbname];
      if (txLocks[this.dbname]) {
        console.log('closing db with transaction queue length: ' + txLocks[this.dbname].queue.length);
      } else {
        console.log('closing db with no transaction lock state');
      }
      cordova.exec(success, error, "SQLitePlugin", "close", [
        {
          path: this.dbname
        }
      ]);
    } else {
      console.log('cannot close: database is not open');
      if (error) {
        nextTick(function() {
          return error();
        });
      }
    }
  };

  SQLitePlugin.prototype.executeSql = function(statement, params, success, error) {
    var myerror, myfn, mysuccess;
    mysuccess = function(t, r) {
      if (!!success) {
        return success(r);
      }
    };
    myerror = function(t, e) {
      if (!!error) {
        return error(e);
      }
    };
    myfn = function(tx) {
      tx.addStatement(statement, params, mysuccess, myerror);
    };
    this.addTransaction(new SQLitePluginTransaction(this, myfn, null, null, false, false));
  };

  SQLitePluginTransaction = function(db, fn, error, success, txlock, readOnly) {
    if (typeof fn !== "function") {

      /*
      This is consistent with the implementation in Chrome -- it
      throws if you pass anything other than a function. This also
      prevents us from stalling our txQueue if somebody passes a
      false value for fn.
       */
      throw newSQLError("transaction expected a function");
    }
    this.db = db;
    this.fn = fn;
    this.error = error;
    this.success = success;
    this.txlock = txlock;
    this.readOnly = readOnly;
    this.canPause = false;
    this.isPaused = false;
    this.executes = [];
    if (txlock) {
      this.addStatement("BEGIN", [], null, function(tx, err) {
        throw newSQLError("unable to begin transaction: " + err.message, err.code);
      });
    }
  };

  SQLitePluginTransaction.prototype.start = function() {
    var err, error1;
    try {
      this.fn(this);
      if (this.executes.length > 0) {
        this.run();
      }
    } catch (error1) {
      err = error1;
      txLocks[this.db.dbname].inProgress = false;
      this.db.startNextTransaction();
      if (this.error) {
        this.error(newSQLError(err));
      }
    }
  };

  SQLitePluginTransaction.prototype.executeSql = function(sql, values, success, error) {
    if (this.finalized) {
      throw {
        message: 'InvalidStateError: DOM Exception 11: This transaction is already finalized. Transactions are committed after its success or failure handlers are called. If you are using a Promise to handle callbacks, be aware that implementations following the A+ standard adhere to run-to-completion semantics and so Promise resolution occurs on a subsequent tick and therefore after the transaction commits.',
        code: 11
      };
      return;
    }
    if (this.readOnly && READ_ONLY_REGEX.test(sql)) {
      this.handleStatementFailure(error, {
        message: 'invalid sql for a read-only transaction'
      });
      return;
    }
    this.addStatement(sql, values, success, error);
    if (this.isPaused) {
      this.isPaused = false;
      this.run();
    }
  };

  SQLitePluginTransaction.prototype.end = function(success, error) {
    if (!this.canPause) {
      throw newSQLError('Sorry invalid usage');
    }
    this.canPause = false;
    this.success = success;
    this.error = error;
    if (this.isPaused) {
      this.isPaused = false;
      if (this.executes.length === 0) {
        this.$finish();
      } else {
        this.run();
      }
    }
  };

  SQLitePluginTransaction.prototype.abort = function(errorcb) {
    if (!this.canPause) {
      throw newSQLError('Sorry invalid usage');
    }
    this.canPause = false;
    this.error = errorcb;
    this.addStatement('INVALID STATEMENT', [], null, null);
    if (this.isPaused) {
      this.isPaused = false;
      this.run();
    }
  };

  SQLitePluginTransaction.prototype.addStatement = function(sql, values, success, error) {
    var l, len1, params, t, v;
    params = [];
    if (!!values && values.constructor === Array) {
      for (l = 0, len1 = values.length; l < len1; l++) {
        v = values[l];
        t = typeof v;
        params.push((v === null || v === void 0 || t === 'number' || t === 'string' ? v : v instanceof Blob ? v.valueOf() : v.toString()));
      }
    }
    this.executes.push({
      success: success,
      error: error,
      sql: sql,
      params: params
    });
    if (MAX_SQL_CHUNK > 0 && this.executes.length > MAX_SQL_CHUNK) {
      this.run();
    }
  };

  SQLitePluginTransaction.prototype.handleStatementSuccess = function(handler, response) {
    var payload, rows;
    if (!handler) {
      return;
    }
    rows = response.rows || [];
    payload = {
      rows: {
        item: function(i) {
          return rows[i];
        },
        length: rows.length
      },
      rowsAffected: response.rowsAffected || 0,
      insertId: response.insertId || void 0
    };
    handler(this, payload);
  };

  SQLitePluginTransaction.prototype.handleStatementFailure = function(handler, response) {
    if (!handler) {
      throw newSQLError("a statement with no error handler failed: " + response.message, response.code);
    }
    if (handler(this, response) !== false) {
      throw newSQLError("a statement error callback did not return false: " + response.message, response.code);
    }
  };

  SQLitePluginTransaction.prototype.run = function() {
    var batchExecutes, handlerFor, tx, txFailure, waiting;
    txFailure = null;
    batchExecutes = this.executes;
    waiting = batchExecutes.length;
    this.executes = [];
    tx = this;
    handlerFor = function(index, didSucceed) {
      return function(response) {
        var err, error1, sqlError;
        try {
          if (didSucceed) {
            tx.handleStatementSuccess(batchExecutes[index].success, response);
          } else {
            sqlError = newSQLError(response);
            if (!!response.result) {
              sqlError.code = response.result.code;
              sqlError.sqliteCode = response.result.sqliteCode;
            }
            tx.handleStatementFailure(batchExecutes[index].error, sqlError);
          }
        } catch (error1) {
          err = error1;
          if (!txFailure) {
            txFailure = newSQLError(err);
          }
        }
        if (--waiting === 0) {
          if (txFailure) {
            tx.$abort(txFailure);
          } else if (tx.executes.length > 0) {
            tx.run();
          } else if (tx.canPause) {
            tx.isPaused = true;
          } else {
            tx.$finish();
          }
        }
      };
    };
    if (useflatjson) {
      this.run_batch_flatjson(batchExecutes, handlerFor);
    } else {
      this.run_batch(batchExecutes, handlerFor);
    }
  };

  SQLitePluginTransaction.prototype.run_batch_flatjson = function(batchExecutes, handlerFor) {
    var flatlist, i, l, len1, mycb, mycbmap, p, ref, request;
    flatlist = [];
    mycbmap = {};
    i = 0;
    while (i < batchExecutes.length) {
      request = batchExecutes[i];
      mycbmap[i] = {
        success: handlerFor(i, true),
        error: handlerFor(i, false)
      };
      flatlist.push(request.sql);
      flatlist.push(request.params.length);
      ref = request.params;
      for (l = 0, len1 = ref.length; l < len1; l++) {
        p = ref[l];
        flatlist.push(p);
      }
      i++;
    }
    mycb = function(result) {
      var c, changes, code, errormessage, insert_id, j, k, q, r, ri, rl, row, rows, sqliteCode, v;
      i = 0;
      ri = 0;
      rl = result.length;
      while (ri < rl) {
        r = result[ri++];
        q = mycbmap[i];
        if (r === 'ok') {
          q.success({
            rows: []
          });
        } else if (r === "ch2") {
          changes = result[ri++];
          insert_id = result[ri++];
          q.success({
            rowsAffected: changes,
            insertId: insert_id
          });
        } else if (r === 'okrows') {
          rows = [];
          changes = 0;
          insert_id = void 0;
          if (result[ri] === 'changes') {
            ++ri;
            changes = result[ri++];
          }
          if (result[ri] === 'insert_id') {
            ++ri;
            insert_id = result[ri++];
          }
          while (result[ri] !== 'endrows') {
            c = result[ri++];
            j = 0;
            row = {};
            while (j < c) {
              k = result[ri++];
              v = result[ri++];
              if (resulturiencoding && typeof v === 'string') {
                v = decodeURIComponent(v);
              }
              row[k] = v;
              ++j;
            }
            rows.push(row);
          }
          q.success({
            rows: rows,
            rowsAffected: changes,
            insertId: insert_id
          });
          ++ri;
        } else if (r === 'error') {
          code = result[ri++];
          sqliteCode = result[ri++];
          errormessage = result[ri++];
          q.error({
            result: {
              code: code,
              sqliteCode: sqliteCode,
              message: errormessage
            }
          });
        }
        ++i;
      }
    };
    cordova.exec(mycb, null, "SQLitePlugin", "backgroundExecuteSqlBatch", [
      {
        dbargs: {
          dbname: this.db.dbname
        },
        flen: batchExecutes.length,
        flatlist: flatlist
      }
    ]);
  };

  SQLitePluginTransaction.prototype.run_batch = function(batchExecutes, handlerFor) {
    var i, mycb, mycbmap, request, tropts;
    tropts = [];
    mycbmap = {};
    i = 0;
    while (i < batchExecutes.length) {
      request = batchExecutes[i];
      mycbmap[i] = {
        success: handlerFor(i, true),
        error: handlerFor(i, false)
      };
      tropts.push({
        qid: 1111,
        sql: request.sql,
        params: request.params
      });
      i++;
    }
    mycb = function(result) {
      var q, r, res, reslength, type;
      i = 0;
      reslength = result.length;
      while (i < reslength) {
        r = result[i];
        type = r.type;
        res = r.result;
        q = mycbmap[i];
        if (q) {
          if (q[type]) {
            q[type](res);
          }
        }
        ++i;
      }
    };
    cordova.exec(mycb, null, "SQLitePlugin", "backgroundExecuteSqlBatch", [
      {
        dbargs: {
          dbname: this.db.dbname
        },
        executes: tropts
      }
    ]);
  };

  SQLitePluginTransaction.prototype.$abort = function(txFailure) {
    var failed, succeeded, tx;
    if (this.finalized) {
      return;
    }
    tx = this;
    succeeded = function(tx) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.error) {
        tx.error(txFailure);
      }
    };
    failed = function(tx, err) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.error) {
        tx.error(newSQLError("error while trying to roll back: " + err.message, err.code));
      }
    };
    this.finalized = true;
    if (this.txlock) {
      this.addStatement("ROLLBACK", [], succeeded, failed);
      this.run();
    } else {
      succeeded(tx);
    }
  };

  SQLitePluginTransaction.prototype.$finish = function() {
    var failed, succeeded, tx;
    if (this.finalized) {
      return;
    }
    tx = this;
    succeeded = function(tx) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.success) {
        tx.success();
      }
    };
    failed = function(tx, err) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.error) {
        tx.error(newSQLError("error while trying to commit: " + err.message, err.code));
      }
    };
    this.finalized = true;
    if (this.txlock) {
      this.addStatement("COMMIT", [], succeeded, failed);
      this.run();
    } else {
      succeeded(tx);
    }
  };

  SQLitePluginTransaction.prototype.abortFromQ = function(sqlerror) {
    if (this.error) {
      this.error(sqlerror);
    }
  };

  dblocations = ["docs", "libs", "nosync"];

  SQLiteFactory = {

    /*
    NOTE: this function should NOT be translated from Javascript
    back to CoffeeScript by js2coffee.
    If this function is edited in Javascript then someone will
    have to translate it back to CoffeeScript by hand.
     */
    opendb: argsArray(function(args) {
      var dblocation, errorcb, first, okcb, openargs;
      if (args.length < 1) {
        return null;
      }
      first = args[0];
      openargs = null;
      okcb = null;
      errorcb = null;
      if (first.constructor === String) {
        openargs = {
          name: first
        };
        if (args.length >= 5) {
          okcb = args[4];
          if (args.length > 5) {
            errorcb = args[5];
          }
        }
      } else {
        openargs = first;
        if (args.length >= 2) {
          okcb = args[1];
          if (args.length > 2) {
            errorcb = args[2];
          }
        }
      }
      dblocation = !!openargs.location ? dblocations[openargs.location] : null;
      openargs.dblocation = dblocation || dblocations[0];
      if (!!openargs.createFromLocation && openargs.createFromLocation === 1) {
        openargs.createFromResource = "1";
      }
      return new SQLitePlugin(openargs, okcb, errorcb);
    }),
    deleteDb: function(first, success, error) {
      var args, dblocation;
      args = {};
      if (first.constructor === String) {
        args.path = first;
        args.dblocation = dblocations[0];
      } else {
        if (!(first && first['name'])) {
          throw new Error("Please specify db name");
        }
        args.path = first.name;
        dblocation = !!first.location ? dblocations[first.location] : null;
        args.dblocation = dblocation || dblocations[0];
      }
      delete SQLitePlugin.prototype.openDBs[args.path];
      return cordova.exec(success, error, "SQLitePlugin", "delete", [args]);
    }
  };

  root.sqlitePlugin = {
    sqliteFeatures: {
      isSQLitePlugin: true
    },
    openDatabase: SQLiteFactory.opendb,
    deleteDatabase: SQLiteFactory.deleteDb
  };

}).call(this);

});
