(window["webpackJsonp"]=window["webpackJsonp"]||[]).push([["apps"],{"45b4":function(t,a,r){"use strict";r.r(a);var e=function(){var t=this,a=t.$createElement,r=t._self._c||a;return r("v-container",[r("center",[r("v-card",{attrs:{"min-height":"200","max-width":"500",rounded:"",shaped:""}},[r("v-card-title",{attrs:{"primary-title":""}},[t._v(" "+t._s(t.apps.length)+" "+t._s(t.$t("App.hardcoded-texts.Installed Apps"))+" "),r("v-spacer"),t.apps.length>0?r("v-tooltip",{attrs:{top:""},scopedSlots:t._u([{key:"activator",fn:function(a){var e=a.on,n=a.attrs;return[r("v-btn",t._g(t._b({attrs:{icon:"",color:"primary","x-large":"",to:"uninstall-app"}},"v-btn",n,!1),e),[r("v-icon",[t._v("mdi-minus")])],1)]}}],null,!1,3365654635)},[r("span",[t._v(t._s(t.$t("App.hardcoded-texts.Uninstall Apps")))])]):t._e(),r("v-tooltip",{attrs:{top:""},scopedSlots:t._u([{key:"activator",fn:function(a){var e=a.on,n=a.attrs;return[r("v-btn",t._g(t._b({attrs:{icon:"",color:"primary","x-large":"",to:"install-app"}},"v-btn",n,!1),e),[r("v-icon",[t._v("mdi-plus")])],1)]}}])},[r("span",[t._v(t._s(t.$t("App.hardcoded-texts.Install New App")))])])],1),t.loadingApps?r("v-progress-linear",{attrs:{indeterminate:!0}}):r("v-card-text",[r("v-layout",{attrs:{row:"",wrap:""}},[t._l(t.apps,(function(a,e){return r("v-flex",{key:e,attrs:{xs3:""}},[r("v-card",{attrs:{hover:"","max-width":"110",height:"170",rounded:"",href:t._f("createAppURL")(a)}},[r("v-card-text",[r("v-avatar",{attrs:{color:"primary",size:"90"}},[r("v-img",{attrs:{src:a.iconBase64}})],1),r("br"),r("label",{staticStyle:{"vertical-align":"bottom",display:"flex"}},[t._v(" "+t._s(a.name)+" ")])],1)],1)],1)})),r("v-spacer")],2)],1)],1)],1)],1)},n=[],p=(r("ac1f"),r("1276"),r("a15b"),r("bc3a")),s=r.n(p),o={data:function(){return{apps:[],loadingApps:!1,baseURL:""}},methods:{getApps:function(){var t=this;this.loadingApps=!0,s.a.get("/apps/installed").then((function(a){t.apps=a.data,t.loadingApps=!1}))}},filters:{createAppURL:function(t){var a=location.href.split("/");return a.pop(),a=a.join("/"),"/gofrapp/"+t.app_short_name+"/"+t.launch_path+"?baseURL="+a}},created:function(){this.getApps();var t=location.href.split("/");t.pop(),t=t.join("/"),this.baseURL=t}},i=o,l=r("2877"),c=r("6544"),d=r.n(c),v=r("8212"),u=r("8336"),f=r("b0af"),h=r("99d9"),_=r("a523"),g=r("0e8f"),b=r("132d"),m=r("adda"),x=r("a722"),A=r("8e36"),V=r("2fa4"),w=r("3a2f"),y=Object(l["a"])(i,e,n,!1,null,null,null);a["default"]=y.exports;d()(y,{VAvatar:v["a"],VBtn:u["a"],VCard:f["a"],VCardText:h["c"],VCardTitle:h["d"],VContainer:_["a"],VFlex:g["a"],VIcon:b["a"],VImg:m["a"],VLayout:x["a"],VProgressLinear:A["a"],VSpacer:V["a"],VTooltip:w["a"]})}}]);
//# sourceMappingURL=apps.94ead83a.js.map