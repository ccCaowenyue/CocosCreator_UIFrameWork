import UIBase from "./UIBase";
import { SysDefine, FormType } from "./config/SysDefine";
import ResMgr from "./ResMgr";
import ModalMgr from "./ModalMgr";
import AdapterMgr, { AdaptaterType } from "./AdapterMgr";
import Scene from "../Scene/Scene";
import { UIWindow } from "./UIForm";
import { IFormData } from "./Struct";
import { EventCenter } from "./EventCenter";
import { EventType } from "./EventType";

const {ccclass, property} = cc._decorator;

@ccclass
export default class UIManager extends cc.Component {    
    private _ndScreen: cc.Node = null;  // 全屏显示的UI 挂载结点
    private _ndFixed: cc.Node  = null;  // 固定显示的UI
    private _ndPopUp: cc.Node  = null;  // 弹出窗口
    private _ndTips: cc.Node   = null;  // 独立窗体

    private _windows: UIWindow[]                                       = [];                   // 存储弹出的窗体
    private _allForms: {[key: string]: UIBase}                         = cc.js.createMap();    // 所有已经挂载的窗体, 可能没有显示
    private _showingForms: {[key: string]: UIBase}                     = cc.js.createMap();    // 正在显示的窗体
    private _tipsForms: {[key: string]: UIBase}                        = cc.js.createMap();    // 独立窗体 独立于其他窗体, 不受其他窗体的影响
    private _loadingForm: {[key: string]: ((value: UIBase) => void)[]} = cc.js.createMap();    // 正在加载的form 
    
    private static instance: UIManager = null;                                                 // 单例
    public static getInstance(): UIManager {
        if(this.instance == null) {
            let canvas = cc.director.getScene().getChildByName("Canvas");
            let scene = canvas.getChildByName(SysDefine.SYS_SCENE_NODE);
            if(!scene) {
                scene = new cc.Node(SysDefine.SYS_SCENE_NODE);
                scene.addComponent(Scene);
                scene.parent = canvas;
            }
            let UIROOT = new cc.Node(SysDefine.SYS_UIROOT_NODE);
            scene.addChild(UIROOT);
            this.instance = cc.find(SysDefine.SYS_UIROOT_NAME).addComponent<UIManager>(this);

            UIROOT.addChild(this.instance._ndScreen = new cc.Node(SysDefine.SYS_SCREEN_NODE));
            UIROOT.addChild(this.instance._ndFixed = new cc.Node(SysDefine.SYS_FIXED_NODE));
            UIROOT.addChild(this.instance._ndPopUp = new cc.Node(SysDefine.SYS_POPUP_NODE));
            UIROOT.addChild(this.instance._ndTips = new cc.Node(SysDefine.SYS_TOPTIPS_NODE));
            ModalMgr.inst;
            cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, () => {
                this.instance = null;
            });
        }
        return this.instance;
    }
    
    start() {        
    }

    /** 预加载UIForm */
    public async loadUIForm(prefabPath: string) {
        let uiBase = await this.loadForm(prefabPath);
        if(!uiBase) {
            console.warn(`${uiBase}没有被成功加载`);
            return null;
        }
        return uiBase;
    }
    
    /**
     * 加载显示一个UIForm
     * @param prefabPath 
     * @param obj 初始化信息, 可以不要
     */
    public async openForm(prefabPath: string, params?: any, formData?: IFormData) {
        if(!prefabPath || prefabPath.length <= 0) {
            cc.warn(`${prefabPath}, 参数错误`);
            return ;
        }
        if(this.checkFormShowing(prefabPath)) {
            cc.warn(`${prefabPath}, 窗体正在显示中`);
            return null;
        }
        let com = await this.loadForm(prefabPath);
        if(!com) {
            cc.warn(`${prefabPath} 加载失败了!`);
            return null;
        }
        // 初始化窗体名称
        com.fid = prefabPath;
        com.formData = formData;
        
        switch(com.formType) {
            case FormType.Screen:
                await this.enterToScreen(com.fid, params);
            break;
            case FormType.Fixed:
                await this.enterToFixed(com.fid, params);
            break;
            case FormType.Window:
                await this.enterToPopup(com.fid, params);
            break;
            case FormType.Tips:                                  // 独立显示
                await this.enterToTips(com.fid, params);
            break;
        }

        return com;
    }
    /**
     * 重要方法 关闭一个UIForm
     * @param prefabPath 
     */
    public async closeForm(prefabPath: string) {
        if(!prefabPath || prefabPath.length <= 0) {
            cc.warn(`${prefabPath}, 参数错误`);
            return ;
        };
        let com = this._allForms[prefabPath];
        if(!com) return false;
        
        switch(com.formType) {
            case FormType.Screen:
                await this.exitToScreen(prefabPath);
            break;
            case FormType.Fixed:                             // 普通模式显示
                await this.exitToFixed(prefabPath);
            break;
            case FormType.Window:
                await this.exitToPopup(prefabPath);
                EventCenter.emit(EventType.WindowClosed, prefabPath);
            break;
            case FormType.Tips:
                await this.exitToTips(prefabPath);
            break;
        }

        EventCenter.emit(EventType.FormClosed, prefabPath);

        if(com.formData) {
            com.formData.onClose && com.formData.onClose();
        }
        // 判断是否销毁该窗体
        if(com.willDestory) {
            this.destoryForm(com, prefabPath);
        }
        return true;
    }

    /**
     * 从窗口缓存中加载(如果没有就会在load加载), 并挂载到结点上
     */
    private async loadForm(prefabPath: string): Promise<UIBase> {
        let com = this._allForms[prefabPath];
        if(com) return com;
        return new Promise((resolve, reject) => {
            if(this._loadingForm[prefabPath]) {
                this._loadingForm[prefabPath].push(resolve);
                return ;
            }
            this._loadingForm[prefabPath] = [resolve];
            this._doLoadUIForm(prefabPath).then((com: UIBase) => {
                for(const func of this._loadingForm[prefabPath]) {
                    func(com);
                }
                this._loadingForm[prefabPath] = null;
                delete this._loadingForm[prefabPath];
            });
        });
    }

    /**
     * 从resources中加载
     * @param prefabPath 
     */
    private async _doLoadUIForm(prefabPath: string) {
        let prefab = await ResMgr.inst.loadForm(prefabPath);
        if(!prefab) {
            cc.warn(`${prefabPath} 资源加载失败, 请确认路径是否正确`);
            return null;
        }
        let node = cc.instantiate(prefab);
        let com = node.getComponent(UIBase);
        if(!com) {
            cc.warn(`${prefabPath} 结点没有绑定UIBase`);
            return null;
        }
        node.active = false;                    // 避免baseCom调用了onload方法
        switch(com.formType) {
            case FormType.Screen:
                this._ndScreen.addChild(node);
            break;
            case FormType.Fixed:
                this._ndFixed.addChild(node);
            break;
            case FormType.Window:
                this._ndPopUp.addChild(node);
            break;
            case FormType.Tips:
                this._ndTips.addChild(node);
            break;
        }
        this._allForms[prefabPath] = com;
        
        return com;
    }

    /** 添加到screen中 */
    private async enterToScreen(fid: string, params: any) {
        // 关闭其他显示的窗口 
        let arr: Array<Promise<boolean>> = [];
        for(let key in this._showingForms) {
            arr.push(this._showingForms[key].closeSelf());
        }
        await Promise.all(arr);

        let com = this._allForms[fid];
        if(!com) return ;
        this._showingForms[fid] = com;

        AdapterMgr.inst.adapatByType(AdaptaterType.FullScreen, com.node);
        
        await com._preInit();
        com.onShow(params);

        await this.showEffect(com);
    }

    /** 添加到Fixed中 */
    private async enterToFixed(fid: string, params: any) {
        let com = this._allForms[fid];
        if(!com) return ;
        await com._preInit();
        
        com.onShow(params);
        this._showingForms[fid] = com;
        await this.showEffect(com);
    }

    /** 添加到popup中 */
    private async enterToPopup(fid: string, params: any) {
        let com = this._allForms[fid] as UIWindow;
        if(!com) return ;
        await com._preInit();

        this._windows.push(com);
        
        for(let i=0; i<this._windows.length; i++) {
            this._windows[i].node.zIndex = i+1;
        }

        com.onShow(params);
        this._showingForms[fid] = com;

        ModalMgr.inst.checkModalWindow(this._windows);
        await this.showEffect(com);
    }
    
    /** 加载到tips中 */
    private async enterToTips(fid: string, params: any) {
        let com = this._allForms[fid];
        if(!com) return ;
        await com._preInit();
        this._tipsForms[fid] = com;
        
        com.onShow(params);
        await this.showEffect(com);
    }

    private async exitToScreen(fid: string) {
        let com = this._showingForms[fid];
        if(!com) return ;
        com.onHide();
        await this.hideEffect(com);
        
        this._showingForms[fid] = null;
        delete this._showingForms[fid];
    }
   
    private async exitToFixed(fid: string) {
        let com = this._allForms[fid];
        if(!com) return ;
        com.onHide();
        await this.hideEffect(com);
        this._showingForms[fid] = null;
        delete this._showingForms[fid];
    }
    
    private async exitToPopup(fid: string) {
        if(this._windows.length <= 0) return;
        let com: UIWindow = null;
        for(let i=this._windows.length-1; i>=0; i--) {
            if(this._windows[i].fid === fid) {
                com = this._windows[i];
                this._windows.splice(i, 1);
            }
        }
        if(!com) return ;
        
        com.onHide();
        ModalMgr.inst.checkModalWindow(this._windows);
        await this.hideEffect(com);
        
        this._showingForms[fid] = null;
        delete this._showingForms[fid];
    }
    
    private async exitToTips(fid: string) {
        let com = this._allForms[fid];
        if(!com) return ;
        com.onHide();
        await this.hideEffect(com);

        this._tipsForms[fid] = null;
        delete this._tipsForms[fid];
    }

    private async showEffect(baseUI: UIBase) {
        baseUI.node.active = true;
        await baseUI.showEffect();
    }
    private async hideEffect(baseUI: UIBase) {
        await baseUI.hideEffect();
        baseUI.node.active = false;
    }

    /** 销毁 */
    private destoryForm(com: UIBase, fid: string) {
        ResMgr.inst.destoryDynamicRes(com.fid);
        ResMgr.inst.destoryForm(com);
        // 从allmap中删除
        this._allForms[fid] = null;
        delete this._allForms[fid];
    }
    /** 窗体是否正在显示 */
    public checkFormShowing(fid: string) {
        let com = this._allForms[fid];
        if (!com) return false;
        return com.node.active;
    }

    /** 窗体是否正在加载 */
    public checkFormLoading(prefabPath: string) {
        let com = this._loadingForm[prefabPath];
        return !!com;
    }

    /** 获得Component */
    public getComponentByFid(fId: string) {
        return this._allForms[fId];
    }
}
