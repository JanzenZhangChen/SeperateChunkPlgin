SeperateChunkPlgin
===================
这是一个webpack插件，你可以通过配置文件将你的所有依赖的文件，自定义打包在一起。

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
如果您之前意境使用过commonChunkPlugin这个插件的话，那么现在只是简单的使用我们的插件替换原来的插件即可。（参数一致，但是minChunks, minSize配置会失效，因为该插件拒接重复打包一个文件的模式，这样不符合该插件的初衷。）
在第一次使用的该插件的时候，插件会生成和commonChunkPlugin一样的打包文件。
同时，也会生成一个seperate.config.js，在项目根目录下。
通过修改该配置，可以自定义修改文件的打包方式。

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
		})
	]
};
```
执行以后，每一个被依赖模块都会生成一个单独的文件，并不会打包成一个文件。并且，会在在项目路径下生成seperate.config.js文件，该文件包含了关于如何打包的配置文件。你可以手动将不同的文件放到一个数组内，意味将这些文件都打包在一起，这个数组的key值便是这个bundle文件的文件名称。
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
但是，由于文件非常多，在html使用script标签加载文件的时候，需要有一定的顺序。所以用户必须使用插件提供的script标签，复制到html里面，来加载文件。这个会在命令行输出给用户，也可以输出成一个文件。
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

- `bundleFiles`: 数组，文件夹的名称。把文件夹下面的文件都打包成一个文件。
- `outputScriptPath`:可以将生成script标签和对应的json生成成一个文件，放到指定的文件里上。
