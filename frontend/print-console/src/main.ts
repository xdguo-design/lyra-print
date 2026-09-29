import { createApp } from 'vue'
import {
  Alert,Badge,Button,Card,Checkbox,Collapse,Descriptions,Divider,Drawer,Dropdown,Empty,
  Form,Input,InputNumber,Layout,Menu,Modal,Pagination,Radio,Result,Select,Slider,Space,
  Spin,Steps,Switch,Table,Tabs,Tag,Timeline,Tooltip
} from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import App from './App.vue'
import './style.css'

const app=createApp(App)
for(const plugin of [
  Alert,Badge,Button,Card,Checkbox,Collapse,Descriptions,Divider,Drawer,Dropdown,Empty,
  Form,Input,InputNumber,Layout,Menu,Modal,Pagination,Radio,Result,Select,Slider,Space,
  Spin,Steps,Switch,Table,Tabs,Tag,Timeline,Tooltip
])app.use(plugin)
app.mount('#app')
