/*
    Author Janzenzhang from Tencent
*/
var fs = require('fs');

var nextIdent = 0;

var defaultCommonName = 'common';

if (!console) {
    console = {
        log: function(a) {
            return
        }
    }
}

// bundleFiles 该文件夹下的文件都需要打包在一起。
function SeperateChunkPlugin(options, filenameTemplate, selectedChunks, minChunks) {
    // if (options && typeof options === "object" && !Array.isArray(options)) {
    //     this.chunkNames = options.name || options.names;
    //     this.filenameTemplate = options.filename;
    //     this.minChunks = options.minChunks;
    //     this.selectedChunks = options.chunks;
    //     if (options.children) this.selectedChunks = false;
    //     this.async = options.async;
    //     this.minSize = options.minSize;
    // } else {
    var chunkNames = defaultCommonName;
    if (typeof filenameTemplate !== "string" && filenameTemplate !== null) {
        minChunks = selectedChunks;
        selectedChunks = filenameTemplate;
        filenameTemplate = chunkNames;
    }
    if (!Array.isArray(selectedChunks) && typeof selectedChunks !== "boolean" && selectedChunks !== null) {
        minChunks = selectedChunks;
        selectedChunks = undefined;
    }
    this.chunkNames = chunkNames;
    this.minChunks = minChunks;
    this.selectedChunks = selectedChunks;
    this.ident = __filename + (nextIdent++);
    this.bundleFiles = options.bundleFiles;
    this.outputScriptPath = options.outputScriptPath;
}

//正式开始拆分
function SeperateChunksInit(chunks, commonChunks, bundleFiles, outputScriptPath, compilation, compiler) {
    var parentChunk = commonChunks[0], // 指定webpack模块初始化器。
        entries = getModuleRelativePathObj(compilation.entries),
        allModules = getAllModulesExceptEnsure(chunks),
        pathModObj = getModuleRelativePathObj(allModules),
        modResToMod = getModResToMod(allModules),
        extraModObj = {},
        config, key;

    bundleFiles = testBundleFiles(bundleFiles);

    chunks = removeExtraModuleWeDontNeed(chunks, getAllDependenciesRes(compilation), extraModObj);

    //没有配置文件的情况下要自动生成配置文件
    if (getConfig()) {
        config = getConfig();
    } else {
        config = generateConfig(chunks, commonChunks, entries, bundleFiles);
    }

    if (testConfig(config)) {
        seperateChunksByConfig.call(this, chunks, config, commonChunks, entries);
        writeConfigToFile(config);
    } else {
        return false
    }

    //做一个转换，以后可能有更多功能
    function testBundleFiles(bundleFiles) {
        var newBundleFiles = bundleFiles;

        if (typeof bundleFiles == 'string') {
            newBundleFiles = [bundleFiles];
        }

        return newBundleFiles
    }

    /**
     * 通过对比dependenice和config，找到config中有的，而dependencies没有的。
     * 把webpack偷偷装的模块去除（比如node-libs-browser中的）
     */
    function removeExtraModuleWeDontNeed(chunks, dependencies, extraModObj) {
        var extraPath,
            extraModuleInstalledByWebpackSecretly = [],
            pathModObj, modRes;

        chunks.forEach(function(chunk) {
            pathModObj = getModuleRelativePathObj(chunk.modules);
            for (modRes in pathModObj) {
                if (!in_array(pathModObj[modRes].resource, dependencies)) {
                    extraModuleInstalledByWebpackSecretly.push(pathModObj[modRes].resource);
                }
            }
        })

        chunks.forEach(function(chunk) {
            chunk.modules.forEach(function(mod) {
                extraModuleInstalledByWebpackSecretly.forEach(function(extraPath) {
                    if (extraPath == mod.resource) {
                        mod.removeChunk(chunk);
                        extraModObj[mod.resource] = mod;
                    }
                })
            })
        })

        return chunks
    }

    function reinstallExtraModuleToEntry(entrychunk, extraModObj) {
        var modRes;
        for (modRes in extraModObj) {
            extraModObj[modRes].addChunk(entrychunk);
            entrychunk.addModule(extraModObj[modRes]);
        }
    }

    /*
     * 根据config来修改最后的chunks
     */
    function seperateChunksByConfig(chunks, config, commonChunks, entries) {
        var parentChunks = [],
            newChunkName,
            targetModules,
            entryName,
            parentChunk,
            findEntryObj,
            parentsChunkObj = {},
            parentsChunkNameArr,
            entryChunkNamesArr,
            parentsChunkNameObj,
            _this = this,
            chunkNameObj,
            parentChunkName,
            chunkname,
            BelongChunksToEntryChunk;

        findEntryObj = findParents(config, entries, commonChunks[0]);
        entryChunkNamesArr = findEntryObj.entriesNamesArr;
        parentsChunkNameObj = findEntryObj.parentsChunkNameObj;
        parentsChunkNameArr = findEntryObj.parentsChunkNameArr;
        BelongChunksToEntryChunk = findEntryObj.BelongChunksToEntryChunk;

        //先把作为parent的chunk generate出来
        parentsChunkNameArr.forEach(function(newChunkName) {
            var newChunk;
            targetModules = [];
            config[newChunkName].forEach(function(moduleName) {
                targetModules.push(modResToMod[getProjectPath() + moduleName]);
            })
            newChunk = generateChunk.call(_this, newChunkName, targetModules, !!in_array(newChunkName, parentsChunkNameArr), chunks, []);
            parentsChunkObj[newChunkName] = newChunk;
        })

        // 把移除的module再次添加到chunk中
        for (parentChunk in parentsChunkObj) {
            reinstallExtraModuleToEntry(parentsChunkObj[parentChunk], extraModObj);
        }

        //再generate 剩余的chunk
        for (newChunkName in config) {
            if (!in_array(newChunkName, parentsChunkNameArr)) {
                targetModules = [];
                config[newChunkName].forEach(function(moduleName) {
                    targetModules.push(modResToMod[getProjectPath() + moduleName]);
                })
                generateChunk.call(_this, newChunkName, targetModules, !!in_array(newChunkName, parentsChunkNameArr), chunks, [parentsChunkObj[parentsChunkNameObj[newChunkName]]]);
            }
        }

        chunkNameObj = getchunkNameObj(chunks);

        /**
         * 往parent chunks 添加各自入口chunks
         * 比如：
         * a.parent = c
         * b.parent = c
         * c.chunks = [a, b]
         * 所以这里要把parentchunk 添加上chunks
         */
        parentsChunkNameArr.forEach(function(parentChunkName) { // parentChunkName = common
            for (chunkname in parentsChunkNameObj) {// chunkname = MyButton
                if (parentsChunkNameObj[chunkname]) {
                    if (chunkNameObj[parentChunkName].chunks.indexOf(chunkNameObj[chunkname]) < 0) {//防止重复添加
                        chunkNameObj[parentChunkName].addChunk(chunkNameObj[chunkname]);
                    }
                }
            }
        })

        //移除所有空的chunk
        removeAllEmptyChunk(chunks);

        generateScript(chunks, outputScriptPath, BelongChunksToEntryChunk, parentsChunkNameArr, commonChunks[0]);
    }

    //生成script标签到console或是文件
    function generateScript(chunks, outputScriptPath, BelongChunksToEntryChunk, parentsChunkNameArr, commonChunk) {
        var entrychunk, chunk,
            commonChunkName = commonChunk.name;
            scriptTpl = '<script src=\"$path$\"></script>\n';
            colorScriptTpl = '<script src=\"\033[32m$path$\033[0m\"></script>'
            outputFileName = compilation.options.output.filename, // [name].js
            outputPath = compilation.options.output.path + '/', // './build/dest' + '/'
            genScriptStringObj = genScriptString(),
            scriptString = genScriptStringObj.finalString,
            scriptJson = genScriptStringObj.finalJson;

        if (outputScriptPath) {
            //输出到文件中
            (function() {
                var fileStr = '/**\n' + scriptString + '*/\nmodule.exports = ';
                fileStr += JSON.stringify(scriptJson, null, 4);
                fs.writeFileSync(getProjectPath() + outputScriptPath, fileStr);
            })()
        }

        function genScriptString() {
            var finalString = '',
                entryToChunk = {},
                finalJson = {};

            //转换一下
            for (chunk in BelongChunksToEntryChunk) {
                entrychunk = BelongChunksToEntryChunk[chunk];
                if (!Array.isArray(entryToChunk[entrychunk])) {
                    entryToChunk[entrychunk] = [];
                }
                entryToChunk[entrychunk].push(chunk);
            }
            //找到当中的parent放在最开头,entry放在最后,common移除
            for (entry in entryToChunk) {
                parentsChunkNameArr.forEach(function(parentchunk) {
                    var parentIndex = in_array(parentchunk, entryToChunk[entry]),
                        entryIndex,
                        commonIndex,
                        temp;
                    if (parentIndex) {
                        temp = entryToChunk[entry].splice(parentIndex, 1);
                        entryToChunk[entry].unshift(temp[0]);
                    }
                    entryIndex = in_array(entry, entryToChunk[entry]);
                    if (entryIndex) {
                        temp = entryToChunk[entry].splice(entryIndex, 1);
                        entryToChunk[entry].push(temp[0]);
                    }
                    commonIndex = in_array(commonChunkName, entryToChunk[entry]);
                    if (commonIndex) {
                        temp = entryToChunk[entry].splice(commonIndex, 1);
                    }
                })
            }

            if (commonChunk.modules.length) {
                for (entrychunk in entryToChunk) {
                    entryToChunk[entrychunk].unshift(commonChunkName);
                }
            }

            for (entrychunk in entryToChunk) {
                console.log('\033[32m' + entrychunk + ' : \033[0m');
                finalString = finalString + entrychunk + '\n';
                finalJson[entrychunk] = [];
                entryToChunk[entrychunk].forEach(function(chunkname) {
                    var nameStr = outputPath + outputFileName.replace(/\[name\]/g, chunkname),
                        colorScriptStr = colorScriptTpl.replace(/\$path\$/g, nameStr);
                        scriptStr = scriptTpl.replace(/\$path\$/g, nameStr);

                    console.log(colorScriptStr);
                    finalString += scriptStr;
                    finalJson[entrychunk].push(nameStr);
                })
            }
            return {
                finalString: finalString,
                finalJson: finalJson  
            }
        }
    }

    //移除所有没有module的空chunk
    function removeAllEmptyChunk(chunks) {
        var i;
        for (i = chunks.length - 1; i > -1; i--) {
            if (chunks[i].modules.length == 0) {
                chunks.splice(i, 1);
            }
        }
    }

    //返回应该有webpack初始化函数的chunkName
    function findParents(config, entryChunks, commonChunk) {
        var commonModules = commonChunk.modules,
            commonModObj = getRelativeModResToMod(commonModules),
            chunkAmountObj = {},
            entriesResources = {},
            moduleResToEntryResObj = {},
            moduleResToEntryChunk = {},
            entryChunkToBelongChunks = {},
            moduleResToChunk = {},
            BelongChunksToEntryChunk = {},
            entryResToEntryChunk = {},
            targetChunks = [],
            parentsChunkArr = [],
            chunkName, moduleName,
            entriesNames = [],
            parentsChunkObj = {},
            longest = 0,
            longestChunk,
            longestChunkName,
            ramdomChunkExceptEntry,
            configChunkName,
            entryRes,
            moduleRes,
            entryChunkName,
            targetChunk;

        /* moduleResToChunk = {
         *      'module resource' : 'trunk',
         *      'module resource' : 'trunk',
         *      ...
         *  } 
         */
        for (chunkName in config) {
            config[chunkName].forEach(function(moduleName) {
                moduleResToChunk[getProjectPath() + moduleName] = chunkName;
            })
        }

        /* entriesResources = {
         *  '入口.resource' : ['module.resource', 'module.resource' ...],
         *  '入口.resource' : ['module.resource', 'module.resource' ...]
         * }
         */
        entriesResources = getEntryDependencies(compilation);
        
        /*
         * moduleResToEntryResObj = {
         *   'config的module.resource'：'该module所在的入口.resource',
         *   'config的module.resource'：'该module所在的入口.resource',
         *   ...
         * }
         */
        for (entryRes in entriesResources) {
            entriesResources[entryRes].forEach(function(moduleRes){
                moduleResToEntryResObj[moduleRes] = entryRes;
            })
        }

        /* 
         * entriesNames: ['入口module所在的configChunkName', '入口module所在的configChunkName'];
         * entryResToEntryChunk: {
         *     'entry module resource': 'entry chunk',
         *     'entry module resource': 'entry chunk',
         *     ...
         * }
         */
        for (chunkname in config) {
            config[chunkname].forEach(function(moduleRes) {
                var fullModuleRes = getProjectPath() + moduleRes;
                if (fullModuleRes in entriesResources) {
                    if (!in_array(chunkname, entriesNames)) {
                        entriesNames.push(chunkname);
                    }
                    entryResToEntryChunk[fullModuleRes] = chunkName;
                }
            })
        }
        
        /*
         *  moduleResToEntryChunk : {
         *      'module resource' : 'entry chunk',
         *      'module resource' : 'entry chunk',
         *      ...
         *  }  
         */
        if (moduleRes in moduleResToEntryResObj) {
            moduleResToEntryChunk[moduleRes] = entryResToEntryChunk[ moduleResToEntryChunk[moduleRes] ];
        }

        /*
         * entryChunkToBelongChunks = {
         *     'config entry chunk' : [chunk, chunk, ...],
         *     'config entry chunk' : [chunk, chunk, ...],
         *     ...
         * }
         */
        for (entryRes in entriesResources) {
            entryChunkToBelongChunks[ moduleResToChunk[entryRes] ] = [];
            entriesResources[ entryRes ].forEach(function(moduleRes) {
                entryChunkToBelongChunks[ moduleResToChunk[entryRes] ].push( moduleResToChunk[moduleRes] );
            })
        }

        /*
         * BelongChunksToEntryChunk = {
         *     'chunk' : 'entry chunk',
         *     'chunk' : 'entry chunk',
         *     ...
         * }
         */
        for (entryChunkName in entryChunkToBelongChunks) {
            entryChunkToBelongChunks[entryChunkName].forEach(function(chunkname) {
                BelongChunksToEntryChunk[chunkname] = entryChunkName;
            })
        }

        /* 
         * 如果commonChunkplugin的逻辑帮我们分析出了全部公共模块
         * 找出这些公共模块在config中所在的所有chunk
         * 找出这些chunk中最大的一个
         * 作为entry=true的chunk。
         */
        if (commonModules.length) {
            for (moduleName in commonModObj) {
                for (chunkName in config) {
                    config[chunkName].forEach(function(configModule) {
                        if (configModule == moduleName) {
                            chunkAmountObj[chunkName] = config[chunkName].length;
                        }
                    })
                }
            }

            for (chunkName in chunkAmountObj) {
                if (chunkAmountObj[chunkName] > longest) {
                    longest = chunkAmountObj[chunkName];
                    longestChunkName = chunkName;
                }
            }

            entriesNames.push(longestChunkName);
            for (chunkName in config) {
                parentsChunkObj[chunkName] = longestChunkName;
            }
            parentsChunkObj[longestChunkName] ='';
            parentsChunkArr.push(longestChunkName);
        }
        /* 
         * 如果commonChunkplugin的逻辑发现，所以入口之间不存在公共模块
         * 找所有该入口依赖的chunks
         * 随便找一个chunk，只要它不是入口chunk。
         * 作为parent chunk
         */
        if (commonModules.length == 0) {
        // if (true) {
            //parentsChunkObj
            for (chunkname in config) {
                (function(chunkname){
                    var tempEntryChunk = BelongChunksToEntryChunk[chunkname];
                    entryChunkToBelongChunks[tempEntryChunk].forEach(function(chunk) {
                        if (chunk == tempEntryChunk && chunk!= chunkname) {
                            return
                        } else {
                            targetChunk = chunk;
                        }
                    })
                    entryChunkToBelongChunks[tempEntryChunk].forEach(function(chunk) {
                        parentsChunkObj[chunk] = targetChunk;
                    })
                })(chunkname);
            }

            for (chunkname in parentsChunkObj) {
                if (parentsChunkObj[chunkname] == chunkname) {
                    parentsChunkObj[chunkname] = '';
                    parentsChunkArr.push(chunkname);
                }
            }        
        }

        /*
         * parentsChunkObj = {
         *     'config chunkname' : '成为parent的config chunkname（不能是入口chunk，不能是其它入口依赖的chunk）',
         *     'config chunkname' : '成为parent的config chunkname（不能是入口chunk，不能是其它入口依赖的chunk）',
         *     '成为parent的config chunkname' : '',
         *     '成为parent的config chunkname' : '',
         *     ...
         * }
         */
        return {
            'entriesNamesArr': entriesNames,
            'parentsChunkNameObj': parentsChunkObj,
            'parentsChunkNameArr': parentsChunkArr,
            'BelongChunksToEntryChunk': BelongChunksToEntryChunk
        }
    }

    /*
     * 生成单个chunk
     * @param newModuleName {string} 新建模块名称
     * @param targetModules {array} module 需要放到chunk里面的module数组
     * @param parentChunk {chunk} 指定的父chunk。
     */
    function generateChunk(newChunkName, targetModules, isEntry, chunks, parentsChunk) {
        var newChunk,
            alreadyHasThisChunk = false,
            alreadyInThisChunk = false,
            _this = this;

        chunks.forEach(function(chunk) {
            if (chunk.name == newChunkName) {
                alreadyHasThisChunk = true;
                newChunk = chunk;
            }
        })

        targetModules.forEach(function(targetModule) {
            if (!alreadyHasThisChunk) {
                newChunk = _this.addChunk(newChunkName);
            }
            //entry为false
            newChunk.initial = true;
            newChunk.entry = isEntry;
            newChunk.parents = [];
            parentsChunk.forEach(function(parentchunk) {
                newChunk.addParent(parentchunk);
            })
            targetModule.chunks.forEach(function(chunk) {
                targetModule.removeChunk(chunk); // 从旧的chunk中移除
            })
            //目标module是不是已经在newchunk里面了是的话就不重复添加
            newChunk.modules.forEach(function(module) {
                if (module.resource == targetModule.resource) {
                    alreadyInThisChunk = true;
                }
            })
            if (!alreadyInThisChunk) {
                newChunk.addModule(targetModule);
            }
            targetModule.addChunk(newChunk); // 添加到新的chunk中去
            newChunk.chunks = [];
        })
        return newChunk
    }

    //获取依赖关系
    function getEntryDependencies(compilation) {
        var entriesResources = {};

        function getDependecies(depBlock) {
            var dependencies = [];
            dependencies.push(depBlock.resource);
            depBlock.dependencies.forEach(function(dep) {
                if (dep.module) {
                    dependencies = dependencies.concat(getDependecies(dep.module));
                }
            })
            return dependencies
        }

        compilation.entries.forEach(function(entry) {
            entriesResources[entry.resource] = [];
            entry.dependencies.forEach(function(dep) {
                if (dep.module) {
                    entriesResources[entry.resource] = entriesResources[entry.resource].concat(getDependecies(dep.module));
                }
            })
            entriesResources[entry.resource].push(entry.resource);
            entriesResources[entry.resource] = removeDuplicates(entriesResources[entry.resource]);
        })

        return entriesResources
    }

    //获取依赖关系中所有module resource(用来和config中的做对比，看看是否有差异)
    function getAllDependenciesRes(compilation) {
        var allDependencies = [],
            entriesResources = getEntryDependencies(compilation),
            entry;

        for (entry in entriesResources) {
            entriesResources[entry].forEach(function(modRes) {
                allDependencies.push(modRes);
            })
        }

        return allDependencies
    }

    // 自动生成配置，不拆分common的模块，保留入口模块在入口chunk
    function generateConfig(chunks, commonChunks, entries, bundleFiles) {
        var config = {},
            pathModObj,
            key,
            chunkname,
            noCommon = false;

        chunks.forEach(function(chunk) {
            pathModObj = getModuleRelativePathObj(chunk.modules);
            //公共chunk的话不拆分
            if (!name_in_chunks(chunk.name, commonChunks)) {
                if (chunk.initial == true) {
                    for (modName in pathModObj) {
                        config[modName] = [getRelativeResource(pathModObj[modName].resource)];
                    }
                }
            } else {
                // 异步chunk不拆分
                commonChunks.forEach(function(commonchunk) {
                    if (commonchunk.modules.length == 0) {
                        noCommon = true;
                    };
                })
                if (noCommon) {
                    return 
                } else {
                    config[chunk.name] = [];
                    for (modName in pathModObj) {
                        config[chunk.name].push(getRelativeResource(pathModObj[modName].resource));
                    }
                }
            }
        })

        for (chunkname in config) {
            bundleFiles.forEach(function(file) {
                if (isChunkInFile(file, chunkname)) {
                    if (!Array.isArray(config[file])) {
                        config[file] = [];
                    }
                    config[file] = config[file].concat(config[chunkname]);
                    delete config[chunkname];
                }
            })
        }

        return config
    }


    function isChunkInFile(file, chunkName) {
        var isTrue = false,
            tempFile;

        if (chunkName.length > file.length) {
            tempFile = chunkName.substring(0, file.length);
            if (tempFile == file) {
                isTrue = true;
            }
        }

        return isTrue
    }

    function getConfig() {
        var configLoc = getConfigPath(),
            config, ret, bool;

        try {
            config = require(configLoc);
        } catch (e) {
            config = false
        }

        return config
    }

    //验证config的格式
    function testConfig(config) {
        //config里面包含的所有文件
        var configResArr = [];

        if (configStruct()) {
            for (chunkname in config) {
                config[chunkname].forEach(function(modName) {
                    configResArr.push(getProjectPath() + modName);
                })
            }

            if (
                emptyChunk() &&
                duplication() &&
                missingFile() &&
                extraFile()
            ) {
                return true
            }
        } else {
            return false
        }

        //config格式一定要是obj,每一个value都是数组，并且里面的值都是字符串
        function configStruct() {
            var ret = true, chunkname;
            if (typeof config !== 'object' || Array.isArray(config)) {
                compilation.errors.push(new Error("seperate.config.js输出格式一定要是object"));
                ret = false;
            } else {
                for (chunkname in config) {
                    if (!Array.isArray(config[chunkname])) {
                        compilation.errors.push(new Error("seperate.config.js输出每一个value一定都是数组"));
                        ret = false;
                    }
                }
                if (ret) {
                    for (chunkname in config) {
                        config[chunkname].forEach(function(modRes) {
                            if (typeof modRes != 'string') {
                                compilation.errors.push(new Error("seperate.config.js输出，数组里面都需要是string类型"));
                                ret = false;
                            }
                        })
                    }
                }
            }

            return ret
        }
        //config中的配置文件没有重复
        function duplication() {
            var chunkname, tempArr,
                hash = {}, wrongFile = [], ret = true;
            
            for (var i = 0, elem; (elem = configResArr[i]) != null; i++) {
                if (!hash[elem]) {
                    hash[elem] = true;
                } else {
                    wrongFile.push(elem + "\n");
                    ret = false;
                }
            }

            if (!ret) {
                compilation.errors.push(new Error("文件存在重复(There are duplicate files in config): \n" + wrongFile));
            }
            return ret;
        }
        //根据dependencies中的modules，config中配置的文件有没有少了文件
        function missingFile() {
            var deps, missingfiles = [], ret = true;
            deps = getAllDependenciesRes(compilation);
            deps.forEach(function(dep) {
                if (!in_array(dep, configResArr)) {
                    missingfiles.push(dep);
                    ret = false;
                }
            })

            if (!ret) {
                compilation.errors.push(new Error("文件缺失(There are missing files in config): \n" + missingfiles));
            }

            return ret
        }
        //config配置中多出了文件 {
        function extraFile() {
            var deps, extrafiles = [], ret = true;
            deps = getAllDependenciesRes(compilation);
            configResArr.forEach(function(res) {
                if (!in_array(res, deps)) {
                    extrafiles.push(res);
                    ret = false;
                }
            })

            if (!ret) {
                compilation.errors.push(new Error("有多余的文件(There are extra files in config): \n" + extrafiles));
            }

            return ret
        }
        //不允许空chunk
        function emptyChunk() {
            var ret = true;
            for (chunkname in config) {
                if (config[chunkname].length == 0) {
                    ret = false;
                }
            }

            if (!ret) {
                compilation.errors.push(new Error("不允许使用空chunk"));
            }

            return ret
        }
    }

    function getConfigPath() {
        var configFileName = 'seperate.config.js',
            path = getProjectPath();
        return path + '/' + configFileName;
    }

    //把配置写到seperate.config.js里面
    function writeConfigToFile(config) {
        var configString = 'module.exports = $config$',
            fileLoc = getConfigPath();
        configString = configString.replace(/\$config\$/g, JSON.stringify(config, null, 4));
        fs.writeFileSync(fileLoc, configString);
    }

    // 获取 (除了公共模块)和(Ensure调用产生的异步模块) 的所有模块
    function getAllModulesExceptEnsure(chunks) {
        var i, allModules = [];

        chunks.forEach(function(chunk) {
            //判断是否是ensure产生chunk
            if (chunk.initial == false) {
                return
            }
            chunk.modules.forEach(function(module) {
                allModules.push(module);
            })
        });

        return allModules
    }

    function getModuleRelativePathObj(allModules) {
        var pathModObj = {};
        allModules.forEach(function(mod) {
            var tempPath = mod.resource.substring(getProjectPath().length, mod.resource.length),
                tempPathArray = tempPath.split('.');

            tempPathArray.splice(tempPathArray.length - 1);
            pathModObj[tempPathArray.join('.')] = mod;
            // pathModObj[tempPath] = mod;
        })
        return pathModObj;
    }

    function getModResToMod(allModules) {
        var modResToMod = {};
        allModules.forEach(function(mod) {
            modResToMod[mod.resource] = mod;
        })
        return modResToMod
    }

    function getRelativeModResToMod(allModules) {
        var modResToMod = {};
        allModules.forEach(function(mod) {
            var tempPath = mod.resource.substring(getProjectPath().length, mod.resource.length);
            modResToMod[tempPath] = mod;
        })
        return modResToMod
    }

    function getchunkNameObj(chunks) {
        var chunkNameObj = {};
        chunks.forEach(function(chunk) {
            chunkNameObj[chunk.name] = chunk;
        })
        return chunkNameObj
    }

    function getRelativeResource(resource) {
        return resource.substring(getProjectPath().length, resource.length)
    }

    // 获取项目的当前的路径
    function getProjectPath() {
        return process.cwd() + '/';
    }

    return chunks
}


module.exports = SeperateChunkPlugin;
SeperateChunkPlugin.prototype.apply = function(compiler) {
    var chunkNames = this.chunkNames;
    var filenameTemplate = this.filenameTemplate;
    var minChunks = this.minChunks;
    var selectedChunks = this.selectedChunks;
    var async = this.async;
    var minSize = this.minSize;
    var ident = this.ident;
    var bundleFiles = this.bundleFiles;
    var outputScriptPath = this.outputScriptPath;
    compiler.plugin("this-compilation", function(compilation) {
        compilation.plugin(["optimize-chunks", "optimize-extracted-chunks"], function(chunks) {
            // console.log(chunks);
            // only optimize once
            if (compilation[ident]) return;
            compilation[ident] = true;

            var commonChunks = [];
            if (!chunkNames && (selectedChunks === false || async)) {
                commonChunks = chunks;
            } else if (Array.isArray(chunkNames) || typeof chunkNames === "string") {
                commonChunks = [].concat(chunkNames).map(function(chunkName) {
                    var chunk = chunks.filter(function(chunk) {
                        return chunk.name === chunkName;
                    })[0];
                    if (!chunk) {
                        chunk = this.addChunk(chunkName);
                        chunk.initial = chunk.entry = true;
                    }
                    return chunk;
                }, this);
            } else {
                throw new Error("Invalid chunkNames argument");
            }

            consoleAllModules(chunks);

            commonChunks.forEach(function processCommonChunk(commonChunk, idx) {
                var commonModulesCount = [];
                var commonModules = [];
                var usedChunks;
                if (Array.isArray(selectedChunks)) {
                    usedChunks = chunks.filter(function(chunk) {
                        if (chunk === commonChunk) return false;
                        return selectedChunks.indexOf(chunk.name) >= 0;
                    });
                } else if (selectedChunks === false || async) {
                    usedChunks = (commonChunk.chunks || []).filter(function(chunk) {
                        // we can only move modules from this chunk if the "commonChunk" is the only parent
                        return async || chunk.parents.length === 1;
                    });
                } else {
                    if (!commonChunk.entry) {
                        compilation.errors.push(new Error("CommonsChunkPlugin: While running in normal mode it's not allowed to use a non-entry chunk (" + commonChunk.name + ")"));
                        return;
                    }
                    usedChunks = chunks.filter(function(chunk) {
                        var found = commonChunks.indexOf(chunk);
                        if (found >= idx) return false;
                        return chunk.entry;
                    });
                }
                if (async) {
                    var asyncChunk = this.addChunk(typeof async === "string" ? async : undefined);
                    asyncChunk.chunkReason = "async commons chunk";
                    asyncChunk.extraAsync = true;
                    asyncChunk.addParent(commonChunk);
                    commonChunk.addChunk(asyncChunk);
                    commonChunk = asyncChunk;
                }
                usedChunks.forEach(function(chunk) {
                    chunk.modules.forEach(function(module) {
                        var idx = commonModules.indexOf(module);
                        if (idx < 0) {
                            commonModules.push(module);
                            commonModulesCount.push(1);
                        } else {
                            commonModulesCount[idx]++;
                        }
                    });
                });
                var reallyUsedChunks = [];
                var reallyUsedModules = [];
                commonModulesCount.forEach(function(count, idx) {
                    var module = commonModules[idx];
                    if (typeof minChunks === "function") {
                        if (!minChunks(module, count))
                            return;
                    } else if (count < (minChunks || Math.max(2, usedChunks.length))) {
                        return;
                    }
                    reallyUsedModules.push(module);
                });
                if (minSize) {
                    var size = reallyUsedModules.reduce(function(a, b) {
                        return a + b.size();
                    }, 0);
                    if (size < minSize)
                        return;
                }
                reallyUsedModules.forEach(function(module) {
                    usedChunks.forEach(function(chunk) {
                        if (module.removeChunk(chunk)) {
                            if (reallyUsedChunks.indexOf(chunk) < 0)
                                reallyUsedChunks.push(chunk);
                        }
                    });
                    commonChunk.addModule(module);
                    module.addChunk(commonChunk);
                });

                usedChunks.forEach(function(chunk) {
                    chunk.parents = [commonChunk];
                    commonChunk.chunks.push(chunk);
                    if (chunk.initial)
                        commonChunk.initial = true;
                    if (chunk.entry) {
                        commonChunk.entry = true;
                        chunk.entry = false;
                    }
                });

                if (filenameTemplate)
                    commonChunk.filenameTemplate = filenameTemplate;
            }, this);

            ///
            consoleAllModules(chunks);

            SeperateChunksInit.call(this, chunks, commonChunks, bundleFiles, outputScriptPath, compilation, compiler);

            consoleAllModules(chunks);
            ///

            this.restartApplyPlugins();
        });
    });
};

function in_array(stringToSearch, arrayToSearch) {
    var s;
    for (s = 0; s < arrayToSearch.length; s++) {
        thisEntry = arrayToSearch[s].toString();
        if (thisEntry == stringToSearch) {
            return s + '';
        }
    }
    return false;
}

function in_object(stringToSearch, objToSearch) {
    return stringToSearch in objToSearch;
}

function name_in_chunks(string, chunks) {
    var ret = false
    chunks.forEach(function(chunk) {
        if (chunk.name == string) {
            ret = true
        }
    })
    return ret
}

function isEmpty(obj) {
    var hasOwnProperty = Object.prototype.hasOwnProperty;
    // null and undefined are "empty"
    if (obj == null) return true;

    // Assume if it has a length property with a non-zero value
    // that that property is correct.
    if (obj.length > 0)    return false;
    if (obj.length === 0)  return true;

    // If it isn't an object at this point
    // it is empty, but it can't be anything *but* empty
    // Is it empty?  Depends on your application.
    if (typeof obj !== "object") return true;

    // Otherwise, does it have any properties of its own?
    // Note that this doesn't handle
    // toString and valueOf enumeration bugs in IE < 9
    for (var key in obj) {
        if (hasOwnProperty.call(obj, key)) return false;
    }

    return true;
}

function removeDuplicates(arr) {
    var result = [], hash = {};
    for (var i = 0, elem; (elem = arr[i]) != null; i++) {
        if (!hash[elem]) {
            result.push(elem);
            hash[elem] = true;
        }
    }
    return result;
}

function consoleAllModules(chunks) {
    debug = false;
    // debug = true;
    if(debug) {
        console.log('-----------------------------');
        console.log('-----------------------------');
        chunks.forEach(function(chunk) {
            console.log('name : ' + chunk.name);
            console.log('initial : ' + chunk.initial);
            console.log('entry : ' + chunk.entry);
            console.log('parents : ');
            if(chunk.parents) {
                chunk.parents.forEach(function(parent) {
                    console.log(parent.name);
                })
            }
            console.log('----');

            console.log('chunks : ');
            if(chunk.chunks) {
                chunk.chunks.forEach(function(chunk) {
                    console.log(chunk.name);
                })
            }
            console.log('----');

            console.log('modules : ');
            // chunk.modules.forEach(function(module) {
            //     console.log(module.rawRequest);
            // })
            console.log('----');
        });

        console.log('-----------------------------');
        console.log('-----------------------------');
    }
}
