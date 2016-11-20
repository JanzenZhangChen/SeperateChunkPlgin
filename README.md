SeperateChunkPlgin
===================
webpack的打包特点一直是倾向于all-in-one的打包方式，尽管有commonsChunkPlugin,等一系列优化工具，但是在一些业务中这样还是会导致性能损耗。 因为系统无法自动地理解文件之间的业务关系，所以无法极致地优化使用体验。

这是一个webpack插件，其让你通过配置文件将你的所有依赖的文件，按照自己的意愿来进行打包，可以打包成任意多个bundle文件，任意祝贺方式。

维护者: janzenzhang

Installation 安装
------------
通过npm安装：
Install the plugin with npm:
```shell
$ npm install seperate-chunk-plugin --save-dev
```

基本用法 Basic Usage
-----------
如果您之前意境使用过commonChunkPlugin这个插件的话，那么现在只是简单的使用我们的插件替换原来的插件即可。所有的参数都保持一致即可。

在第一次使用的该插件的时候，插件的作用和commonChunkPlugin一模一样。
但同时，也会生成一个seperate.config.js的配置文件，在项目根目录下，与webpack.config.js在一个文件夹下。
通过修改该配置，则可以自定义修改文件的打包方式。

config as follows:
按如下方式使用：

```javascript
var SeperateChunkPlugin = require('seperate-chunk-plugin');
var webpackConfig = {
	entry: 'index.js',
	output: {
		path: 'dist',
		filename: '[name].js'
	},
	plugins: [
		new SeperateChunkPlugin({
			name: 'common'
			, minChunks: 10 //类似的commonsChunkPlugin的参数，完全一致
		})
	]
};
```
在第一次使用以后，效果与实用commonsChunkPlugin没有差别，但会在在项目路径下生成seperate.config.js文件，该文件包含了关于如何打包的配置文件。你可以手动将不同的文件放到一个数组内，意味将这些文件都打包在一起，这个数组的key值便是这个bundle文件的name值。

```javascript
module.exports = {
	"components/b": [
		"components/b.jsx"
	],
	"index": [
		"index.jsx"
	],
	"node_modules": [
		"node_modules/react/react.js",
		...
	]
}
```
但是，由于可能自定的文件非常多，在html使用script标签加载文件的时候，需要有一定的顺序。
比如带有webpack模块管理的模块要第一个执行，入口文件需要放到最后执行。为了方便使用，会在命令行输出可以直接使用的script标签。
所以用户必须使用插件提供的script标签，复制到html里面，来加载文件。这个会在命令行输出给用户，也可以输出成一个文件。

```html
<script src="./build/dest/common.js"></script>
<script src="./build/dest/components/MyButtonController.js"></script>
<script src="./build/dest/stores/ListStore.js"></script>
<script src="./build/dest/node_modules/webpack/node_modules/node-libs-browser/node_modules/events/events.js"></script>
```

配置Configuration
-------------
你可以使用配置的对象值初始化插件。可以使用以下配置项。
You can pass a hash of configuration options to `Seperate_chunk_plugin`.
Allowed values are as follows:

- `outputScriptPath`:可以将生成script标签和对应的json生成成一个文件，放到指定的文件里上。这样子可以针对这个文件进行进一步的解析。应用于其他的插件上，或是配置工具。
