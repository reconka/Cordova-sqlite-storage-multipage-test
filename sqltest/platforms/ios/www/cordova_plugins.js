cordova.define('cordova/plugin_list', function(require, exports, module) {
module.exports = [
    {
        "file": "plugins/cordova-sqlite-evfree/www/SQLitePlugin.js",
        "id": "cordova-sqlite-evfree.SQLitePlugin",
        "pluginId": "cordova-sqlite-evfree",
        "clobbers": [
            "SQLitePlugin"
        ]
    }
];
module.exports.metadata = 
// TOP OF METADATA
{
    "cordova-plugin-whitelist": "1.2.0",
    "cordova-sqlite-evfree": "0.8.2-rc"
}
// BOTTOM OF METADATA
});