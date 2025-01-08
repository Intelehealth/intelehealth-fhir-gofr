(window["webpackJsonp"]=window["webpackJsonp"]||[]).push([["chunk-b33551c6"],{"23a7":function(t,e,i){"use strict";var n=i("2909"),a=i("5530"),s=i("53ca"),o=(i("a9e3"),i("caad"),i("d81d"),i("b0c0"),i("99af"),i("a434"),i("159b"),i("fb6a"),i("5803"),i("2677")),r=i("cc20"),l=i("80d2"),u=i("d9bd"),c=i("d9f7");e["a"]=o["a"].extend({name:"v-file-input",model:{prop:"value",event:"change"},props:{chips:Boolean,clearable:{type:Boolean,default:!0},counterSizeString:{type:String,default:"$vuetify.fileInput.counterSize"},counterString:{type:String,default:"$vuetify.fileInput.counter"},hideInput:Boolean,multiple:Boolean,placeholder:String,prependIcon:{type:String,default:"$file"},readonly:{type:Boolean,default:!1},showSize:{type:[Boolean,Number],default:!1,validator:function(t){return"boolean"===typeof t||[1e3,1024].includes(t)}},smallChips:Boolean,truncateLength:{type:[Number,String],default:22},type:{type:String,default:"file"},value:{default:void 0,validator:function(t){return Object(l["I"])(t).every((function(t){return null!=t&&"object"===Object(s["a"])(t)}))}}},computed:{classes:function(){return Object(a["a"])(Object(a["a"])({},o["a"].options.computed.classes.call(this)),{},{"v-file-input":!0})},computedCounterValue:function(){var t=this.multiple&&this.lazyValue?this.lazyValue.length:this.lazyValue instanceof File?1:0;if(!this.showSize)return this.$vuetify.lang.t(this.counterString,t);var e=this.internalArrayValue.reduce((function(t,e){var i=e.size,n=void 0===i?0:i;return t+n}),0);return this.$vuetify.lang.t(this.counterSizeString,t,Object(l["x"])(e,1024===this.base))},internalArrayValue:function(){return Object(l["I"])(this.internalValue)},internalValue:{get:function(){return this.lazyValue},set:function(t){this.lazyValue=t,this.$emit("change",this.lazyValue)}},isDirty:function(){return this.internalArrayValue.length>0},isLabelActive:function(){return this.isDirty},text:function(){var t=this;return this.isDirty||!this.isFocused&&this.hasLabel?this.internalArrayValue.map((function(e){var i=e.name,n=void 0===i?"":i,a=e.size,s=void 0===a?0:a,o=t.truncateText(n);return t.showSize?"".concat(o," (").concat(Object(l["x"])(s,1024===t.base),")"):o})):[this.placeholder]},base:function(){return"boolean"!==typeof this.showSize?this.showSize:void 0},hasChips:function(){return this.chips||this.smallChips}},watch:{readonly:{handler:function(t){!0===t&&Object(u["b"])("readonly is not supported on <v-file-input>",this)},immediate:!0},value:function(t){var e=this.multiple?t:t?[t]:[];Object(l["k"])(e,this.$refs.input.files)||(this.$refs.input.value="")}},methods:{clearableCallback:function(){this.internalValue=this.multiple?[]:null,this.$refs.input.value=""},genChips:function(){var t=this;return this.isDirty?this.text.map((function(e,i){return t.$createElement(r["a"],{props:{small:t.smallChips},on:{"click:close":function(){var e=t.internalValue;e.splice(i,1),t.internalValue=e}}},[e])})):[]},genControl:function(){var t=o["a"].options.methods.genControl.call(this);return this.hideInput&&(t.data.style=Object(c["d"])(t.data.style,{display:"none"})),t},genInput:function(){var t=o["a"].options.methods.genInput.call(this);return t.data.attrs.multiple=this.multiple,delete t.data.domProps.value,delete t.data.on.input,t.data.on.change=this.onInput,[this.genSelections(),t]},genPrependSlot:function(){var t=this;if(!this.prependIcon)return null;var e=this.genIcon("prepend",(function(){t.$refs.input.click()}));return this.genSlot("prepend","outer",[e])},genSelectionText:function(){var t=this.text.length;return t<2?this.text:this.showSize&&!this.counter?[this.computedCounterValue]:[this.$vuetify.lang.t(this.counterString,t)]},genSelections:function(){var t=this,e=[];return this.isDirty&&this.$scopedSlots.selection?this.internalArrayValue.forEach((function(i,n){t.$scopedSlots.selection&&e.push(t.$scopedSlots.selection({text:t.text[n],file:i,index:n}))})):e.push(this.hasChips&&this.isDirty?this.genChips():this.genSelectionText()),this.$createElement("div",{staticClass:"v-file-input__text",class:{"v-file-input__text--placeholder":this.placeholder&&!this.isDirty,"v-file-input__text--chips":this.hasChips&&!this.$scopedSlots.selection}},e)},genTextFieldSlot:function(){var t=this,e=o["a"].options.methods.genTextFieldSlot.call(this);return e.data.on=Object(a["a"])(Object(a["a"])({},e.data.on||{}),{},{click:function(){return t.$refs.input.click()}}),e},onInput:function(t){var e=Object(n["a"])(t.target.files||[]);this.internalValue=this.multiple?e:e[0],this.initialValue=this.internalValue},onKeyDown:function(t){this.$emit("keydown",t)},truncateText:function(t){if(t.length<Number(this.truncateLength))return t;var e=Math.floor((Number(this.truncateLength)-1)/2);return"".concat(t.slice(0,e),"…").concat(t.slice(t.length-e))}}})},2677:function(t,e,i){"use strict";var n=i("8654");e["a"]=n["a"]},5803:function(t,e,i){},b62a:function(t,e,i){"use strict";(function(t){i("d3b7"),i("3ca3"),i("ddb0"),i("2b3d"),i("9861"),i("b0c0"),i("25f0"),i("2ca0");var n=i("bc3a"),a=i.n(n),s=i("d79a");e["a"]={name:"fhir-attachment",props:["field","label","min","max","id","path","slotProps","sliceName","base-min","base-max","edit","readOnlyIfSet","constraints"],components:{GofrElement:s["a"]},data:function(){return{source:{path:"",data:{}},loading:!1,upload:void 0,value:{contentType:"",data:"",title:""},origValue:{contentType:"",data:"",title:""},qField:"valueAttachment",disabled:!1,objURL:"",errors:[],lockWatch:!1}},created:function(){this.setupData()},watch:{slotProps:{handler:function(){this.lockWatch||this.setupData()},deep:!0}},methods:{setupData:function(){if(this.slotProps&&this.slotProps.source)if(this.source={path:this.slotProps.source.path+"."+this.field,data:{}},this.slotProps.source.fromArray)this.source.data=this.slotProps.source.data,this.value=this.source.data,this.origValue=this.value,this.lockWatch=!0;else{var t=this.$fhirutils.pathFieldExpression(this.field);this.source.data=this.$fhirpath.evaluate(this.slotProps.source.data,t),1==this.source.data.length&&(this.value=this.source.data[0],this.origValue=this.value,this.lockWatch=!0)}this.setObjectURL(),this.disabled=this.readOnlyIfSet&&!!this.value},setObjectURL:function(){var t=this;if(this.objURL&&URL.revokeObjectURL(this.objURL),this.value.data&&this.value.contentType){var e="data:"+this.value.contentType+";base64,"+this.value.data;a()({method:"GET",url:e,responseType:"blob"}).then((function(e){t.objURL=URL.createObjectURL(e.data)})).catch((function(t){console.log("Failed to get data from base64.",t)}))}},doUpload:function(){var e=this;if(this.errors=[],this.upload){this.loading=!0,this.value.contentType=this.upload.type,this.value.title=this.upload.name;var i=new FileReader;i.readAsArrayBuffer(this.upload),i.onload=function(){var n=t.from(i.result);e.value.data=n.toString("base64"),e.loading=!1,e.objURL=URL.createObjectURL(e.upload)}}else this.upload=void 0,this.value=this.origValue,this.objURL=""}},computed:{isImage:function(){return this.value.contentType&&this.value.contentType.startsWith("image/")},index:function(){return this.slotProps&&this.slotProps.input?this.slotProps.input.index:void 0},display:function(){return this.slotProps&&this.slotProps.input?this.slotProps.input.label:this.label},required:function(){return(this.index||0)<this.min},rules:function(){var t=this;return this.required?[function(e){return!!e||t.display+" is required"}]:[]}}}}).call(this,i("b639").Buffer)},ca33:function(t,e,i){"use strict";i.r(e);var n=function(){var t=this,e=t.$createElement,i=t._self._c||e;return i("gofr-element",{attrs:{edit:t.edit,loading:!1},scopedSlots:t._u([{key:"form",fn:function(){return[i("v-file-input",{attrs:{disabled:t.disabled,label:t.$t("App.fhir-resources-texts."+t.display),loading:t.loading,outlined:"","hide-details":"auto",rules:t.rules,dense:"","error-messages":t.errors},on:{change:t.doUpload},scopedSlots:t._u([{key:"label",fn:function(){return[t._v(t._s(t.$t("App.fhir-resources-texts."+t.display))+" "),t.required?i("span",{staticClass:"red--text font-weight-bold"},[t._v("*")]):t._e()]},proxy:!0},{key:"append-outer",fn:function(){return[t.objURL?i("v-menu",{attrs:{"offset-y":"",left:"",eager:""},scopedSlots:t._u([{key:"activator",fn:function(e){var n=e.on,a=e.attrs;return[i("v-btn",t._g(t._b({attrs:{color:"accent",dark:"",fab:"","x-small":""}},"v-btn",a,!1),n),[i("v-icon",[t._v("mdi-file-eye")])],1)]}}],null,!1,3582535098)},[i("v-list",[i("v-list-item",[t.isImage?i("v-img",{attrs:{src:t.objURL}}):i("a",{attrs:{download:t.value.title,href:t.objURL}},[t._v(t._s(t.value.title))])],1)],1)],1):t._e()]},proxy:!0}]),model:{value:t.upload,callback:function(e){t.upload=e},expression:"upload"}})]},proxy:!0},{key:"header",fn:function(){return[t._v(" "+t._s(t.$t("App.fhir-resources-texts."+t.display))+" ")]},proxy:!0},{key:"value",fn:function(){return[t.isImage?i("v-menu",{attrs:{absolute:"",eager:""},scopedSlots:t._u([{key:"activator",fn:function(e){var n=e.on,a=e.attrs;return[i("v-img",t._g(t._b({attrs:{src:t.objURL,contain:"","max-height":150,position:"left"}},"v-img",a,!1),n))]}}],null,!1,3173132963)},[i("v-list",{attrs:{"min-width":"0"}},[i("v-list-item",[i("v-img",{attrs:{src:t.objURL}})],1)],1)],1):i("a",{attrs:{href:t.objURL}},[t._v(t._s(t.value.title))])]},proxy:!0}])})},a=[],s=i("b62a"),o=s["a"],r=i("2877"),l=i("6544"),u=i.n(l),c=i("8336"),h=i("23a7"),d=i("132d"),p=i("adda"),f=i("8860"),v=i("da13"),b=i("e449"),m=Object(r["a"])(o,n,a,!1,null,null,null);e["default"]=m.exports;u()(m,{VBtn:c["a"],VFileInput:h["a"],VIcon:d["a"],VImg:p["a"],VList:f["a"],VListItem:v["a"],VMenu:b["a"]})},d79a:function(t,e,i){"use strict";var n=function(){var t=this,e=t.$createElement,i=t._self._c||e;return i("div",[t.edit?i("v-container",[t._t("form")],2):i("div",[i("v-row",{attrs:{dense:""}},[i("v-col",{staticClass:"font-weight-bold",attrs:{cols:t.$store.state.cols.header}},[t._t("header")],2),t.loading?i("v-col",{attrs:{cols:t.$store.state.cols.content}},[i("v-progress-linear",{attrs:{indeterminate:"",color:"primary"}})],1):i("v-col",{attrs:{cols:t.$store.state.cols.content}},[t._t("value")],2)],1),i("v-divider")],1)],1)},a=[],s={name:"gofr-element",props:["edit","loading"]},o=s,r=i("2877"),l=i("6544"),u=i.n(l),c=i("62ad"),h=i("a523"),d=i("ce7e"),p=i("8e36"),f=i("0fd9"),v=Object(r["a"])(o,n,a,!1,null,null,null);e["a"]=v.exports;u()(v,{VCol:c["a"],VContainer:h["a"],VDivider:d["a"],VProgressLinear:p["a"],VRow:f["a"]})}}]);
//# sourceMappingURL=chunk-b33551c6.ed68db25.js.map