/*
    Author Janzenzhang from Tencent
*/
var fs = require('fs');
var path = require('path');
var MODULE = require('module');

var nextIdent = 0;

if (!console) {
    console = {
        log: function(a) {
            return
        }
    }
}

// bundleFiles 该文件夹下的文件都需要打包在一起。
function SeperateChunkPlugin(options, filenameTemplate, selectedChunks, minChunks) {
    if(options && typeof options === "object" && !Array.isArray(options)) {
        this.chunkNames = options.name || options.names;
        this.filenameTemplate = options.filename;
        this.minChunks = options.minChunks;
        this.selectedChunks = options.chunks;
        if(options.children) this.selectedChunks = false;
        this.async = options.async;
        this.minSize = options.minSize;
        this.outputScriptFile = options.outputScriptFile;
        this.bundleFiles = options.bundleFiles;
    } else {
        var chunkNames = options;
        if(typeof filenameTemplate !== "string" && filenameTemplate !== null) {
            minChunks = selectedChunks;
            selectedChunks = filenameTemplate;
            filenameTemplate = chunkNames;
        }
        if(!Array.isArray(selectedChunks) && typeof selectedChunks !== "boolean" && selectedChunks !== null) {
            minChunks = selectedChunks;
            selectedChunks = undefined;
        }
        this.chunkNames = chunkNames;
        this.filenameTemplate = filenameTemplate;
        this.minChunks = minChunks;
        this.selectedChunks = selectedChunks;
    }
    this.ident = __filename + (nextIdent++);
}

//正式开始拆分
function SeperateChunksInit(chunks, commonChunks, bundleFiles, outputScriptFile, compilation, compiler) {
    var parentChunk = commonChunks[0], // 指定webpack模块初始化器。
        allModules = getAllModulesExceptEnsure(chunks),
        entries = getModuleRelativePathObjWithoutType(compilation.entries),
        pathModObj = getModuleRelativePathObjWithoutType(allModules),
        modResToMod = getModResToMod(allModules),
        extraModObj = {},
        originChunks = [],
        config, key;

    bundleFiles = testBundleFiles(bundleFiles);

    chunks = removeExtraModuleWeDontNeed(chunks, getAllDependenciesRes(compilation), extraModObj);

    chunks.forEach(function(chunk) {
        originChunks.push(chunk);
    })

    //没有配置文件的情况下要自动生成配置文件
    if (getConfig()) {
        config = getConfig();
    } else {
        config = generateConfig(chunks, commonChunks, entries, bundleFiles);
    }
    //判断config结构,并且根据情况会修改config的内容
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

        if (typeof bundleFiles == 'undefined') {
            newBundleFiles = [];
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
            pathModObj = getModuleRelativePathObjWithoutType(chunk.modules);
            for (modRes in pathModObj) {
                if (!in_array(getModuleResource(pathModObj[modRes]), dependencies) && chunk.initial == true) {
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

        //先把现有的chunk里面的module都移除
        removeAllChunksModule(allModules, originChunks);

        //先把作为parent的chunk generate出来
        parentsChunkNameArr.forEach(function(newChunkName) {
            var newChunk;
            targetModules = [];
            config[newChunkName].forEach(function(moduleName) {
                targetModules.push(modResToMod[addProjectPath(moduleName)]);
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
                    targetModules.push(modResToMod[addProjectPath(moduleName)]);
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
                if (parentsChunkNameObj[chunkname] == parentChunkName) {
                    if (chunkNameObj[parentChunkName].chunks.indexOf(chunkNameObj[chunkname]) < 0) {//防止重复添加
                        chunkNameObj[parentChunkName].addChunk(chunkNameObj[chunkname]);
                    }
                }
            }
        })

        /**
         * 去重每一个chunk下的chunks
         */
        // for (chunkname in chunks) {
        //     chunks[chunkname].chunks = removeDupicatesOfObj(chunks[chunkname].chunks);
        // }

        //设置异步chunk的parent的
        chunks.forEach(function(asyncChunk) {
            var parentNameArr = [];
            if (asyncChunk.initial == false) {
                asyncChunk.parents.forEach(function(parentchunk) {
                    parentchunk.chunks.push(asyncChunk);
                })
            }
        })

        //移除所有空的chunk
        removeAllEmptyChunk(chunks);

        generateScript(chunks, outputScriptFile, BelongChunksToEntryChunk, parentsChunkNameArr);
    }

    // 先把现有的chunk里面的module都移除
    function removeAllChunksModule(allModules, originChunks) {
        allModules.forEach(function(module) {
            originChunks.forEach(function(chunk) {
                module.removeChunk(chunk);
            })
        })
    }

    // 把所有的module的内容
    function setModResource(allModules) {
        compiler.options.resolve.extensions.forEach(function(ext) {
            if (ext && !MODULE._extensions[ext]) {
                MODULE._extensions[ext] = function() {
                    //空的 因为module._findPath需要遍历后缀，然后才能找到没有带后缀的文件。
                }
            }
        });
        allModules.forEach(function(mod) {
            if (!mod.resource) {
                // if (mod.reasons[0]) {
                //     mod.resource = mod.reasons[0].dependency.request;
                // } else {
                mod.resource = mod.request || mod.name || mod.reasons[0].dependency.request;
                // }
                // try {
                //     mod.resource = require.resolve(mod.reasons[0].dependency.request);
                // } catch (e) {
                //     try {
                //         mod.resource = require.resolve(mod.reasons[0].module.context + '/' + mod.reasons[0].dependency.request);
                //     } catch (e) {
                //         mod.resource = mod.reasons[0].module.context + '/' + mod.reasons[0].dependency.request;
                //     }
                // }
                // console.log(mod.resource);
            }
        })
    }

    //生成script标签到console或是文件
    function generateScript(chunks, outputScriptFile, BelongChunksToEntryChunk, parentsChunkNameArr) {
        var entrychunk, chunk,
            scriptTpl = '<script src=\"$path$\"></script>\n';
            colorScriptTpl = '<script src=\"\033[32m$path$\033[0m\"></script>'
            outputFileName = compilation.options.output.filename, // [name].js
            outputPath = getRelativeResourcePath(compilation.options.output.publicPath ? compilation.options.output.publicPath : compilation.options.output.path + '/'), // './build/dest' + '/'
            genScriptStringObj = genScriptString(),
            scriptString = genScriptStringObj.finalString,
            scriptJson = genScriptStringObj.finalJson;

        if (outputScriptFile) {
            //输出到文件中
            (function() {
                var fileStr = '/**\n' + scriptString + '*/\nmodule.exports = ';
                fileStr += JSON.stringify(scriptJson, null, 4);
                fs.writeFileSync(path.resolve(getProjectPath() + outputScriptFile), fileStr);
            })()
        }

        function genScriptString() {
            var finalString = '',
                entryToChunk = {},
                finalJson = {};

            //转换一下
            for (chunk in BelongChunksToEntryChunk) {
                entrychunks = BelongChunksToEntryChunk[chunk];
                entrychunks.forEach(function(entrychunk) {
                    if (!entryToChunk[entrychunk]) {
                        entryToChunk[entrychunk] = [];
                    }
                    if (!in_array(chunk, entryToChunk[entrychunk])) {
                        entryToChunk[entrychunk].push(chunk);
                    }
                })
            }

            //找到当中的parent放在最开头,entry放在最后
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
                })
            }

            for (entrychunk in entryToChunk) {
                if (!outputScriptFile) {
                    console.log('\033[32m' + entrychunk + ' : \033[0m');                    
                }
                finalString = finalString + entrychunk + '\n';
                finalJson[entrychunk] = [];
                entryToChunk[entrychunk].forEach(function(chunkname) {
                    var nameStr = outputPath + outputFileName.replace(/\[name\]/g, chunkname),
                        colorScriptStr = colorScriptTpl.replace(/\$path\$/g, nameStr);
                        scriptStr = scriptTpl.replace(/\$path\$/g, nameStr);
                    if (!outputScriptFile) {
                        console.log(colorScriptStr);                        
                    }
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
            allModObj = getRelativeModResToMod(allModules),
            chunkAmountObj = {},
            entriesResources = {},
            moduleResToEntryResObj = {},
            entryChunkToBelongChunks = {},
            moduleResToChunk = {},
            BelongChunksToEntryChunk = {},
            entryResToEntryChunk = {},
            entryChunkToEntryRes = {},
            UsedTimeObj = {},
            siblingChunkObj = {},
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
         *      'module resource' : 'chunk',
         *      'module resource' : 'chunk',
         *      ...
         *  }
         * moduleResToChunk = {
         *      'module resource' : ['chunk1', 'chunk2'],
         *      'module resource' : ['chunk'],
         *      ...
         *  }
         */
        for (chunkName in config) {
            config[chunkName].forEach(function(moduleName) {
                if (!moduleResToChunk[addProjectPath(moduleName)]) {
                    moduleResToChunk[addProjectPath(moduleName)] = [];
                }
                if (!in_array(chunkName, moduleResToChunk[addProjectPath(moduleName)])) {
                    moduleResToChunk[addProjectPath(moduleName)].push(chunkName);
                }
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
         *   'config的module.resource'：['该module所在的入口.resource', '第二个入口的resource'],
         *   'config的module.resource'：['该module所在的入口.resource'],
         *   ...
         * }
         */
        for (entryRes in entriesResources) {
            entriesResources[entryRes].forEach(function(moduleRes){
                if (!moduleResToEntryResObj[moduleRes]) {
                    moduleResToEntryResObj[moduleRes] = [];
                }
                if (!in_array(entryRes, moduleResToEntryResObj[moduleRes])) {
                    moduleResToEntryResObj[moduleRes].push(entryRes);
                }
            })
        }

        /* 
         * entriesNames: ['入口module所在的configChunkName', '入口module所在的configChunkName'];
         * entryResToEntryChunk: {
         *     'entry module resource': 'entry chunk',
         *     'entry module resource': 'entry chunk',
         *     ...
         * }
         * entryChunkToEntryRes: {
         *     'entry chunk': 'entry module resource',
         *     'entry chunk': 'entry module resource',
         *     ...
         * }
         */
        for (chunkname in config) {
            config[chunkname].forEach(function(moduleRes) {
                var fullModuleRes = addProjectPath(moduleRes);
                if (fullModuleRes in entriesResources) {
                    if (!in_array(chunkname, entriesNames)) {
                        entriesNames.push(chunkname);
                    }
                    entryResToEntryChunk[fullModuleRes] = chunkname;
                    entryChunkToEntryRes[chunkname] = fullModuleRes;
                }
            })
        }

        /*
         *比较关键的是这个函数。每一个入口函数，所依赖的chunk。
         *  entryChunkToBelongChunks = {
         *     'config entry chunk' : [chunk, chunk, ...],
         *     'config entry chunk' : [chunk, chunk, ...],
         *     ...
         * }
         */
        for (entryRes in entriesResources) {
            entryChunkToBelongChunks[ moduleResToChunk[entryRes][0] ] = [];

            entriesResources[ entryRes ].forEach(function(moduleRes) {
                moduleResToChunk[moduleRes].forEach(function(chunkname) {
                    /**
                     * 这里对于每一个入口chunk，依赖的modules，每一个module所在chunk都添加进来.
                     * 但是这样就所有带有这个module的chunk都添加了进来,其实是冗余的
                     */
                    entryChunkToBelongChunks[ moduleResToChunk[entryRes][0] ].push(chunkname);
                })
            })
            entryChunkToBelongChunks[ moduleResToChunk[entryRes][0] ] = removeDuplicates(entryChunkToBelongChunks[moduleResToChunk[entryRes][0]]);
        }
        /**
         * 这时候的entryChunkToBelongChunks充满了冗余的chunk,必须要去除。
         * 使用贪心算法，去除不需要文件，找到最优解。
         * 当前这个入口所需要的所有modules, 拥有这些module的所有chunks,现在要去除重复没必要的chunk,寻求精简的最优解
         */
        function filterChunk(needModules, chunks) {
            var noNeedChunk = [];
            var finalChunks;
            //找到每一个chunks里面相对不需要的，最大的那个，去除。
            function findBiggest(chunks) {
                var chunkSizeObj = {},
                    biggestSize = 0,
                    biggestChunk,
                    chunkname;
                chunks.forEach(function(chunkname) {
                    var size = config[chunkname].reduce(function(a, b) {
                        return a + allModObj[b].size();
                    }, 0);
                    chunkSizeObj[chunkname] = size;
                })
                for (chunkname in chunkSizeObj) {
                    if (chunkSizeObj[chunkname] > biggestSize) {
                        biggestSize = chunkSizeObj[chunkname];
                        biggestChunk = chunkname;
                    }
                }
                return biggestChunk
            };
            //是否需要这个chunk
            function isNeed(targetChunk, chunks, needModules) {
                var tempObj = {},
                    need = false;
                chunks = removeChunk(targetChunk, chunks);
                chunks.forEach(function(chunk) {
                    config[chunk].forEach(function(module) {
                        tempObj[module] = true;
                    })
                })
                needModules.forEach(function(module) {
                    if (!tempObj[getRelativeResource(module)]) {
                        need = true;
                    }
                })
                return need
            };
            //移除这个chunk
            function removeChunk(targetChunk ,chunks) {
                var tempChunks = JSON.parse(JSON.stringify(chunks));
                tempChunks.forEach(function(chunkname, index) {
                    if (chunkname == targetChunk) {
                        tempChunks.splice(index, 1);
                    }
                });
                return tempChunks
            };
            // main
            // 找不需要的chunk，然后纪录下来。
            chunks.forEach(function(chunk) {
                if (!isNeed(chunk, chunks, needModules)) {
                    noNeedChunk.push(chunk);
                }
            })
            //找不到不需要chunk了，就直接返回原本的chunk
            if (noNeedChunk.length == 0) {
                return chunks
            }
            // 找到了一些不需要的chunk，就找他们体积最大的去除。
            chunk = findBiggest(noNeedChunk);
            finalChunks = removeChunk(chunk, chunks);
            //递归再继续
            return filterChunk(needModules, finalChunks);
        }
        //开始执行贪心算法
        for (chunkname in entryChunkToBelongChunks) {
            entryChunkToBelongChunks[chunkname] = filterChunk(entriesResources[entryChunkToEntryRes[chunkname]], entryChunkToBelongChunks[chunkname]);
        }

        /*
         * BelongChunksToEntryChunk = {
         *     'chunk' : ['entry chunk', 'entry chunk'],
         *     'chunk' : ['entry chunk'],
         *     ...
         * }
         */
        for (entryChunkName in entryChunkToBelongChunks) {
            entryChunkToBelongChunks[entryChunkName].forEach(function(chunkname) {
                if (!BelongChunksToEntryChunk[chunkname]) {
                    BelongChunksToEntryChunk[chunkname] = [];
                }
                if (!in_array(entryChunkName, BelongChunksToEntryChunk[chunkname])) {
                    BelongChunksToEntryChunk[chunkname].push(entryChunkName);
                }
            })
        }

        /**
         * 兄弟chunk:被自己的所有入口chunk引用的所有其他chunk，包括自己
         * siblingChunkObj: {
         *     '每一个chunkname': ['chunkname', 'chunkname'],
         *     '每一个chunkname': ['chunkname'],
         *     '每一个chunkname': ['chunkname', 'chunkname'],
         * }
         */
        for (chunkname in config) {
            BelongChunksToEntryChunk[chunkname].forEach(function(entryChunk) {
                entryChunkToBelongChunks[entryChunk].forEach(function(siblingChunk) {
                    if (!siblingChunkObj[chunkname]) {
                        siblingChunkObj[chunkname] = [siblingChunk];
                    } else {
                        if (!in_array(siblingChunk, siblingChunkObj[chunkname])) {
                            siblingChunkObj[chunkname].push(siblingChunk);
                        }
                    }
                })
            })
        }

        /**
         * UsedTimeObj，每一个chunk被页面需要的次数
         */
        for (chunkname in  BelongChunksToEntryChunk) {
            if ((BelongChunksToEntryChunk[chunkname].length == 1) && (BelongChunksToEntryChunk[chunkname][0] == chunkname)) {
                UsedTimeObj[chunkname] = 0;
            } else {
                UsedTimeObj[chunkname] = BelongChunksToEntryChunk[chunkname].length;
            }
        }
        /**
         * 执行寻找parent的算法
         */
        // console.log(entryChunkToBelongChunks);
        // console.log(BelongChunksToEntryChunk);
        // console.log(siblingChunkObj);
        // console.log(UsedTimeObj);
        var notEntry = '$$notEntry$$',
            noParents = '$$noParents$$';
        for (chunkname in config) {
            var mostUsedChunk = findMostUsedChunk(siblingChunkObj[chunkname], chunkname, UsedTimeObj, parentsChunkObj, parentsChunkArr, notEntry, noParents, compilation);
            //如果发现没有能找到entry说明进入了死锁情景。那么就拿一个已有的parentChunk作为入口
            if (mostUsedChunk == chunkname && siblingChunkObj[chunkname].length > 1) {
                parentsChunkObj[chunkname] = noParents;
            }

            siblingChunkObj[chunkname].forEach(function(sibling) {
                if (sibling == mostUsedChunk) {
                    parentsChunkObj[chunkname] = mostUsedChunk;
                    pushWithoutDuplication(mostUsedChunk, parentsChunkArr);
                } else if (!(sibling in entryChunkToBelongChunks) && !parentsChunkObj[chunkname]){
                    parentsChunkObj[chunkname] = notEntry;
                }
            })
        }
        // console.log(parentsChunkObj);
        // console.log(parentsChunkArr);
        /* 
         * 如果commonChunkplugin的逻辑帮我们分析出了全部公共模块
         * 找出这些公共模块在config中所在的所有chunk
         * 找出这些chunk中最大的一个
         * 作为entry=true的chunk。
         */
        // if (commonModules.length) {
        //     for (moduleName in commonModObj) {
        //         for (chunkName in config) {
        //             config[chunkName].forEach(function(configModule) {
        //                 if (configModule == moduleName) {
        //                     chunkAmountObj[chunkName] = config[chunkName].length;
        //                 }
        //             })
        //         }
        //     }

        //     for (chunkName in chunkAmountObj) {
        //         if (chunkAmountObj[chunkName] > longest) {
        //             longest = chunkAmountObj[chunkName];
        //             longestChunkName = chunkName;
        //         }
        //     }

        //     entriesNames.push(longestChunkName);
        //     for (chunkName in config) {
        //         parentsChunkObj[chunkName] = longestChunkName;
        //     }
        //     parentsChunkObj[longestChunkName] ='';
        //     parentsChunkArr.push(longestChunkName);
        // }
        // /* 
        //  * 如果commonChunkplugin的逻辑发现，所以入口之间不存在公共模块
        //  * 找所有该入口依赖的chunks
        //  * 随便找一个chunk，只要它不是入口chunk。
        //  * 作为parent chunk
        //  */
        // if (commonModules.length == 0) {
        // // if (true) {
        //     //parentsChunkObj
        //     for (chunkname in config) {
        //         (function(chunkname){
        //             BelongChunksToEntryChunk[chunkname].forEach(function(tempEntryChunk) {
        //                 entryChunkToBelongChunks[tempEntryChunk].forEach(function(chunk) {
        //                     if (chunk == tempEntryChunk && chunk!= chunkname) {
        //                         return
        //                     } else {
        //                         targetChunk = chunk;
        //                     }
        //                 })
        //                 entryChunkToBelongChunks[tempEntryChunk].forEach(function(chunk) {
        //                     parentsChunkObj[chunk] = targetChunk;
        //                 })
        //             })
        //         })(chunkname);
        //     }

        //     for (chunkname in parentsChunkObj) {
        //         if (parentsChunkObj[chunkname] == chunkname) {
        //             parentsChunkObj[chunkname] = '';
        //             parentsChunkArr.push(chunkname);
        //         }
        //     }        
        // }

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
            // targetModule.chunks.forEach(function(chunk) {
            //     originChunks.forEach(function(originChunk) {
            //         if (originChunk == chunk) {
            //             targetModule.removeChunk(chunk); // 从旧的chunk中移除
            //         };
            //     })
            // })
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

        function getDependecies(depBlock, parentDependecies) {
            var dependencies = [];
            if (in_array(depBlock.resource, parentDependecies)) {
                // console.log('--存在循环依赖:---');
                // console.log(depBlock.resource);
                // console.log('-----------------');
                // console.log('former res : ' + depBlock.resource);
                // console.log('parent : ' + depObj[depBlock.resource].parent);
                // console.log('-----------');
                pushWithoutDuplication(depBlock.resource, dependencies);
                return dependencies
            }

            pushWithoutDuplication(depBlock.resource, dependencies);

            depBlock.dependencies.forEach(function(dep) {
                if (dep.module) {
                    dependencies = dependencies.concat(getDependecies(dep.module, parentDependecies.concat([depBlock.resource])));
                }
            })

            return dependencies
        }

        compilation.entries.forEach(function(entry) {
            var entryRes = getModuleResource(entry);
            entriesResources[entryRes] = [];
            entry.dependencies.forEach(function(dep) {
                if (dep.module) {
                    entriesResources[entryRes] = entriesResources[entryRes].concat(getDependecies(dep.module, getModuleResource(dep.module) == entryRes ? [] : [entryRes]));
                }
            })
            entriesResources[entryRes].push(entryRes);
            entriesResources[entryRes] = removeDuplicates(entriesResources[entryRes]);
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

        return removeDuplicates(allDependencies);
    }

    /**
     * 已经废弃
     * 自动生成配置，不拆分common的模块，保留入口模块在入口chunk
     */
    function generateConfig_seperate(chunks, commonChunks, entries, bundleFiles) {
        var config = {},
            pathModObj,
            key,
            chunkname,
            noCommon = false;

        chunks.forEach(function(chunk) {
            pathModObj = getModuleRelativePathObjWithoutType(chunk.modules);
            //非公共chunk的话，进行拆分
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

    /**
     * generateConfig 不拆分，所有chunk保持原样
     */
    function generateConfig(chunks, commonChunks, entries, bundleFiles) {
        var config = {},
            pathModObj,
            key,
            chunkname,
            noCommon = false;

        removeAllEmptyChunk(chunks);

        chunks.forEach(function(chunk) {
            var modName;
            // 非异步模块
            if (chunk.initial == true) {
                pathModObj = getModuleRelativePathObjWithoutType(chunk.modules);
                config[chunk.name] = [];
                for (modName in pathModObj) {
                    config[chunk.name].push(getRelativeResource(getModuleResource(pathModObj[modName])));
                }
                config[chunk.name] = removeDuplicates(config[chunk.name]);
            }
        })
        // bundleFiles参数
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
            config = 'hehe', ret, bool;

        try {
            config = require(configLoc);
        } catch (e) {
            // console.log(e);
            config = false
        }

        return config
    }

    //验证config的格式 返回真假
    function testConfig(config) {
        //config里面包含的所有文件
        var configResArr = [],
            missingFiles = [],
            ret = {}; // 错误返回值。

        //判断的主要逻辑 （先判断是否符合格式）
        if (configStruct()) {
            for (chunkname in config) {
                config[chunkname].forEach(function(modName) {
                    configResArr.push(addProjectPath(modName));
                })
            }

            if (
                emptyChunk() && // 空的chunk 不允许
                checkChunkDuplication() && // chunk内不允许重复，总体允许
                // checkDuplication() && // 重复文件 （@todo应该允许,但是感觉很不好做）
                checkMissingEntryFile() && // 不允许丢失入口文件
                extraFile() //多余文件，不允许。
            ) {
                //满足上述情况下，如果有丢失的文件，那么找出来。
                checkMissingFile(config);
                return true
            } else {
                return false
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
        function checkDuplication() {
            var hash = {}, wrongFile = [], ret = true;

            for (var i = 0, elem; (elem = configResArr[i]) != null; i++) {
                if (!hash[elem]) {
                    hash[elem] = true;
                } else {
                    wrongFile.push(elem + "\n");
                    ret = false;
                }
            }

            if (!ret) {
                compilation.warnings.push(new Error("配置中有重复出现的文件，但在同一入口依赖的chunk下只会生成一次哦。(There are duplicate files in config): \n" + wrongFile));
            }
            //尽管有重复文件，但是允许，只是提示。
            return true;
        }

        //config中的配置文件在同个chunk内不能重复，在总体的可以重复。
        function checkChunkDuplication() {
            var hash, ret = true, wrongFile = [];

            for (var j in config) {
                hash = {};
                for (var i = 0, elem; (elem = config[j][i]) != null; i++) {
                    if (!hash[elem]) {
                        hash[elem] = true;
                    } else {
                        wrongFile.push(elem + "\n");
                        ret = false;
                    }
                }
            }

            if (!ret) {
                compilation.errors.push(new Error("同一个chunk内不允许存在重复文件(There are duplicate files in config‘s chunks): \n" + wrongFile));
            }

            return ret
        }

        //验证config文件中不能缺少入口文件
        function checkMissingEntryFile() {
            var entryRelaResArr = [],
                chunkName,
                ret = true,
                missEntryArr = [],
                allConfigMods = flatConfig(config);

            compilation.entries.forEach(function(entry) {
                entryRelaResArr.push(getRelativeResource(getModuleResource(entry)));
            })

            entryRelaResArr.forEach(function(entry) {
                if (!in_array(entry, allConfigMods)) {
                    missEntryArr.push(entry);
                    ret = false
                }
            })

            function flatConfig(config) {
                var allConfigMods = [],
                    chunkName;
                for (chunkName in config) {
                    config[chunkName].forEach(function(mod) {
                        allConfigMods.push(mod);
                    })
                }

                return allConfigMods
            }

            missEntryArr = removeDuplicates(missEntryArr);
            if (!ret) {
                compilation.errors.push(new Error("入口文件缺失(There are missing entry files in config): \n" + missEntryArr));
            }

            return ret
        }

        //根据dependencies中的modules，config中配置的文件有没有少了文件
        function checkMissingFile(config) {
            var deps, missingFiles = [], ret = true;
            deps = getAllDependenciesRes(compilation);
            deps.forEach(function(dep) {
                if (!in_array(dep, configResArr)) {
                    missingFiles.push(getRelativeResource(dep));
                    ret = false;
                }
            })

            missingFiles = removeDuplicates(missingFiles);

            function changeConfig() {
                /** 
                 * 直接
                 */
                var modMap = getModuleRelativePathObj(getAllModulesExceptEnsure(chunks));
                missingFiles.forEach(function(file) {
                    if (file in modMap) {
                        if (modMap[file].chunks.length == 1) {
                            config[findChunkForOriginChunk(modMap[file].chunks[0])].unshift(file);
                        } else {
                            modMap[file].chunks.forEach(function(chunk) {
                                config[findChunkForOriginChunk(chunk)].unshift(file);
                            })
                        }
                    }
                })

                function findChunkForOriginChunk(chunk) {
                    var targetChunkName,
                        chunkName,
                        targetModName = getRelativeResource(chunk.modules[0].resource);

                    for (chunkName in config) {
                        if (in_array(targetModName, config[chunkName])) {
                            targetChunkName = chunkName;
                        }
                    }

                    return targetChunkName
                }
            }

            changeConfig();

            if (!ret) {
                compilation.warnings.push(new Error("文件缺失,并且已自动帮您添加到seperate.config.js中(There are missing files in config, but we already put it in seperate.config.js for you): \n" + missingFiles));
            }

            return ret
        }
        //config配置中多出了文件 {
        function extraFile() {
            var deps, extrafiles = [], ret = true;
            deps = getAllDependenciesRes(compilation);
            configResArr.forEach(function(res) {
                if (!in_array(res, deps)) {
                    extrafiles.push(getRelativeResource(res));
                    ret = false;
                }
            })

            if (!ret) {
                compilation.errors.push(new Error("配置中有多余的文件(There are extra files in config): \n" + extrafiles.join('\n')));
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
        return path + configFileName;
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

        setModResource(allModules);

        return allModules
    }

    function getModuleRelativePathObjWithoutType(allModules) {
        setModResource(allModules);
        var pathModObj = {};
        allModules.forEach(function(mod) {
            if (mod.resource.length > getProjectPath().length) {
                var tempPath = mod.resource.substring(getProjectPath().length, mod.resource.length),
                    tempPathArray = tempPath.split('.');

                tempPathArray.splice(tempPathArray.length - 1);
                pathModObj[tempPathArray.join('.')] = mod;
            } else {
                pathModObj[mod.resource] = mod;
            }
        })
        return pathModObj;
    }

    function getModuleRelativePathObj(allModules) {
        var pathModObj = {};
        allModules.forEach(function(mod) {
            if (mod.resource.length > getProjectPath().length) {
                var tempPath = mod.resource.substring(getProjectPath().length, mod.resource.length);
                pathModObj[tempPath] = mod;
            } else {
                pathModObj[mod.resource] = mod;
            }
        })
        return pathModObj;
    }


    function getModResToMod(allModules) {
        var modResToMod = {};
        allModules.forEach(function(mod) {
            modResToMod[getModuleResource(mod)] = mod;
        })
        return modResToMod
    }

    function getRelativeModResToMod(allModules) {
        var modResToMod = {};
        allModules.forEach(function(mod) {
            if (mod.resource.length > getProjectPath().length) {
                var tempPath = mod.resource.substring(getProjectPath().length, mod.resource.length);
                modResToMod[tempPath] = mod;
            } else {
                modResToMod[mod.resource] = mod;
            }
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
        var testStr = '', ext;
        if (compilation.compiler.options.externals) {
            for (ext in compilation.compiler.options.externals) {
                if (compilation.compiler.options.externals[ext] == resource) {
                    return resource
                }
            }
        }

        if (getProjectPath().length > resource.length) {
            return resource
        }

        testStr = resource.substring(0, getProjectPath().length);

        if (testStr == getProjectPath()) {
            return resource.substring(getProjectPath().length, resource.length)
        } else {
            return resource
        }
    }

    function getRelativeResourcePath(resource) {
        if (compilation.compiler.options.externals) {
            for (ext in compilation.compiler.options.externals) {
                if (compilation.compiler.options.externals[ext] == resource) {
                    return resource
                }
            }
        }

        if (getProjectPath().length > resource.length) {
            return resource
        }

        testStr = resource.substring(0, getProjectPath().length);

        if (testStr == getProjectPath()) {
            return './' + resource.substring(getProjectPath().length, resource.length)
        } else {
            return resource
        }
    }

    function addProjectPath(modname) {
        if (compilation.compiler.options.externals) {
            for (ext in compilation.compiler.options.externals) {
                if (compilation.compiler.options.externals[ext] == modname) {
                    return modname
                }
            }
        }

        return getProjectPath() + modname;
    }

    function getModuleResource(module) {
        if (module.request) {
            //普通的module的情况
            return module.resource;
        } else {
            //babel-polyfill这样的包的情况
            // return module.dependencies[0].module.resource;
            return getProjectPath() + module.resource;
        }
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
    var outputScriptFile = this.outputScriptFile;
    compiler.plugin("this-compilation", function(compilation) {
        compilation.plugin(["optimize-chunks", "optimize-extracted-chunks"], function(chunks) {
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

            SeperateChunksInit.call(this, chunks, commonChunks, bundleFiles, outputScriptFile, compilation, compiler);

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

function removeDupicatesOfObj(arr) {
    var tempArr = [];
    arr.forEach(function(obj, index) {
        var tempObj = tempArr.splice(index, 1);
        if (!in_array(tempObj, tempArr)) {
            tempArr.push(tempObj);
        }
    })
    return tempArr
}

function pushWithoutDuplication(value, targetArr) {
    if (!targetArr) {
        targetArr = [value];
    } else {
        if (!in_array(value, targetArr)) {
            targetArr.push(value);
        }
    }
}

/**
 * 找到最经常用到的那个chunk
 */
function findMostUsedChunk(siblings, self, UsedTimeObj, parentsChunkObj, parentsChunkArr, notEntry, noParents, compilation) {
    var mostUsedChunk = self,
        finded = false,
        findedNumber = 0;
    siblings.forEach(function(siblingChunk) {
        //如果有一个已经是parent了,那么直接拿他当mostUsedChunk
        if (in_array(siblingChunk, parentsChunkArr)) {
            finded = true;
            findedNumber++;
            mostUsedChunk = siblingChunk;
        //找最大的被引用次数的
        } else if (!finded && mostUsedChunk && (UsedTimeObj[siblingChunk] > UsedTimeObj[mostUsedChunk])) {
            //如果这个mostUsedChunk已经找到自己的parent了，则不能当别人的parent。
            if (!parentsChunkObj[mostUsedChunk]) {
                mostUsedChunk = siblingChunk;
            }
        }
    })
    if (findedNumber > 1) {
        compilation.errors.push(new Error("如此构造bundle文件，会导致同一个页面有两个入口函数，从而使页面无法运行"));
    }
    return mostUsedChunk;
}

function consoleAllModules(chunks) {
    debug = false;
    // debug = true;
    if (debug) {
        console.log('-----------------------------');
        console.log('-----------------------------');
        chunks.forEach(function(chunk) {
            console.log('name : ' + chunk.name);
            console.log('initial : ' + chunk.initial);
            console.log('entry : ' + chunk.entry);
            console.log('parents : ');
            if (chunk.parents) {
                chunk.parents.forEach(function(parent) {
                    console.log(parent.name);
                })
            }
            console.log('----');

            console.log('chunks : ');
            if (chunk.chunks) {
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
