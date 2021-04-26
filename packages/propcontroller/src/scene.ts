import Const from "./Const";
const fs = require('fire-fs');

const _localSaveFunc: {[key: number]: (saveData: any, com: any, comPropCtrl: any) => void} = {};
let ROOT_NODE: cc.Node = null as any;

module scene {
    
    function _readFile(path: string, callback: Function) {
        fs.readFile(path, 'utf8', (err: any, data: string) => {
            if(!err) {
                callback(JSON.parse(data));
            }else {
                callback({});
            }
        });  
    }
    
    function _doSetProp(comPropCtrl: any, NodeRoot: cc.Node, saveData: any) {
        let coms = NodeRoot.getComponentsInChildren("PropSelector");
        for(const com of coms) {
            // 只处理当前状态的控制器属性
            if(com.ctrlId !== comPropCtrl.id) {
                continue;
            }
            
            for(const e of com.props) {
                let func = _localSaveFunc[e];
                func(saveData, com, comPropCtrl);
            }
        }
    }
    /** 
     * 入口
     * 1, 查看是否启用了controller, 即检查根结点是否有PropController脚本即可
     * 2, 查找所有PropSelector, 根据所属控制器和所属type, 生成json文件并保持到本地
     * 3, 将json文件绑定到对应的controller中
     *      
     */
    export function start() { 
        let childs = cc.director.getScene().children;
        if(childs.length < 3) return null;
        let NodeRoot = ROOT_NODE = childs[1];

        let comPropCtrl = NodeRoot.getComponent("PropController");
        if(!comPropCtrl) {
            // Editor.warn(`${NodeRoot.name} 没有挂载 PropController 脚本`);
            return;
        }
        let PropEmum = (cc as any).PropEmum;
        _regiestSaveFunction(PropEmum.Position, _savePosition);
        _regiestSaveFunction(PropEmum.Color, _saveColor);
        _regiestSaveFunction(PropEmum.Scale, _saveScale);
        

        let saveData: {[key: string]: any} = {};
        let ProjectDir = Editor.Project.path;
        let ScriptName = `${NodeRoot.name}_Auto`;
        let ScriptPath = `${ProjectDir}/${Const.JsonsDir}/${ScriptName}.json`.replace(/\\/g, "/");
              
        if(comPropCtrl.type < 0 || comPropCtrl.type >= comPropCtrl.types.length) {
            cc.warn(`PropController, ${comPropCtrl.id} 控制器的 type 越界了`);
            return ;
        }

        _readFile(ScriptPath, (data: any) => {
            saveData = data;
            // 把当前状态的数据置空
            saveData[comPropCtrl.types[comPropCtrl.type]] = {};
            _doSetProp(comPropCtrl, NodeRoot, saveData);

            let json = JSON.stringify(saveData);
            checkScriptDir();
            
            fs.writeFileSync(ScriptPath, json);
            let dbJsonPath = ScriptPath.replace(ProjectDir, "db:/");
            Editor.assetdb.refresh(dbJsonPath, (err: any, data: any) => {
                cc.assetManager.loadAny({uuid: data[0].uuid}, (err: any, data: any) => {
                    comPropCtrl.propertyJson = data;
                });
                // Editor.log('控制器数据保存成功-', dbJsonPath);
            });

        }); 
    }

    function checkScriptDir() {
        let dir = Editor.Project.path + '/' + Const.JsonsDir;
        if(!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        return dir;
    }

    function _getNodePath(node: cc.Node, rootNode: cc.Node) {
        let parent = node;
        let path = '';
        while(parent) {
            if(parent.uuid == rootNode.uuid) {
                break;
            }
            path += '/' + parent.name;
            parent = parent.parent;
        }
        return path;
    }

    function _regiestSaveFunction(propId: number, func: (saveData: any, com: any, comPropCtrl: any) => void) {
        if(_localSaveFunc[propId]) {
            // cc.warn(`prop: ${propId}, 已经被注册了, 此次注册将会覆盖上次的func`);
            return ;
        }
        _localSaveFunc[propId] = func;
    }

    function _checkSaveData(saveData: any, com: any, controller: any) {
        let type = controller.types[controller.type];
        let map = saveData[type];
        if(!map) map = saveData[type] = {};
        let path = _getNodePath(com.node, ROOT_NODE);
        let d = map[path];
        if(!d) d = map[path] = {};

        return d;
    }

    function _savePosition(saveData: any, com: any, controller: any) {
        let d = _checkSaveData(saveData, com, controller);
        d[(cc as any).PropEmum.Position] = com.node.position;
    }

    function _saveColor(saveData: any, com: any, controller: any) {
        let d = _checkSaveData(saveData, com, controller);
        d[(cc as any).PropEmum.Color] = {
            r: com.node.color.r,
            g: com.node.color.g,
            b: com.node.color.b,
            a: com.node.color.a,
        }
    }

    function _saveScale(saveData: any, com: any, controller: any) {
        let d = _checkSaveData(saveData, com, controller);
        d[(cc as any).PropEmum.Scale] = {
            scaleX: com.node.scaleX,
            scaleY: com.node.scaleY
        };
    }

}
module.exports = scene;