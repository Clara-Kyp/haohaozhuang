# 好好装 · 完整陈设与实时3D编辑

[在线体验](https://clara-kyp.github.io/haohaozhuang/) · [1 分钟介绍](https://clara-kyp.github.io/haohaozhuang/showcase/haohaozhuang.mp4) · [路演 PPT](https://clara-kyp.github.io/haohaozhuang/showcase/haohaozhuang.pptx)

GitHub Pages 体验版可以选择示例户型、调整陈设和材质，并把草稿保存在浏览器。体验版使用内置陈设，上传识别、AI 规划和提案、商品导入及烘焙需要按下文启动本地 API。推送到 `main` 会自动重新部署在线体验版。


当前主链路：**户型与风格参考 → 完整陈设提案 → 家具、尺寸、位置与理由 → 用户确认 → 加载模型 → 3D逐件编辑**。已移除写实图片生成、对比页、任务轮询及ComfyUI/Celery/Redis运行依赖。历史模型权重和输出保留，不自动删除。

## 云端 AI 体验

[部署到 Render](https://render.com/deploy?repo=https://github.com/Clara-Kyp/haohaozhuang)

1. 使用 Render 导入仓库的 `render.yaml`，在 Render 的环境变量中填写 `MINIMAX_API_KEY`。服务会生成 `HAOHAO_ACCESS_CODE`，用于给试用者开放在线 AI。
2. 服务上线后，将其 HTTPS 地址设为 GitHub 仓库 Actions 变量 `AI_API_ORIGIN`，然后重新运行 **Deploy GitHub Pages**。
3. 在网站首页点击「有邀请码？启用在线 AI」，输入邀请码。启用后即可上传户型图、生成布局和陈设。商品导入与 2K 烘焙在本地版使用。

可在 Render 的 `HAOHAO_INVITE_HASHES` 中添加额外邀请码的 SHA-256 十六进制摘要，以空格分隔。原邀请码可继续使用。

未设置云端地址时，GitHub Pages 继续提供示例体验。

## 启动

在本项目目录执行：

```bash
.venv/bin/python scripts/start_local.py
```

访问 http://127.0.0.1:5173/ 。启动器只启动API和前端并复用已有服务，日志在.runtime/logs/。后端依赖见backend/requirements.txt，前端使用npm install。模型配置沿用.env；陈设规划有参考图时调用视觉模型，无参考图时调用文本模型。未配置或调用失败会显示错误，仍可编辑已有空间。

技术：React + React Three Fiber/Three.js + Zustand + FastAPI。图像输入用于户型/陈设理解及商品规格核对；3D内容来自明确资产或经过校验的商品图近似结构数据。

## 已实现

- 原图识别、尺寸校准、保留布局或多风格分区候选；房间用途可更正。
- 风格、居住需求及最多三张参考图进入真实模型请求；提案含清单、尺寸、坐标、朝向、理由及平面预览。
- 资产白名单；边界、碰撞、示意入口、台面支撑校验；坐标校正逐项展示。用户确认后才应用，失败保留已有场景。
- 独立物件点选、拖动、旋转、尺寸、材质调色、锁定、同类替换、增添、删除、撤销；台面配饰随宿主变动。
- 六面饰面、吊顶、玻璃窗、环境反射、接触阴影和壁挂电视编辑保留。
- 运行时粘贴HTTPS商品链接/分享文本，解析实际默认SKU、真实图片、颜色款式和尺寸；用户核对后按规格替换选中物件，可撤销保存。没有页面默认SKU时先选择，尺寸缺失先补齐。
- 明确区分商品页GLB、商品图近似结构和相似目录模型；不把相似素材冒充厂家同款。页面价格带读取时间，以商品页为准，未接库存/下单。
- 登录/验证可通过独立本地商品浏览器完成，再继续读取；凭证不进入前端/模型。通用JSON-LD、Shopify、淘宝/天猫详情结构已适配，实际商城页面覆盖仍取决于可读信息与登录状态。
- IndexedDB保存各房间物件、提案、参考图和机位；旧存档恢复原场景，不展示或轮询旧图片任务。

## 模型资源

app/public/models/sources.json记录11款Poly Haven CC0资产及本地资源大小。执行scripts/fetch_furniture.py可重新下载并校验MD5。含休闲椅、茶几、收纳柜、边几、绿植、花器、书籍、台灯、餐椅、餐桌及复古沙发。复古沙发按真实风格标注，不冒充现代布艺或欧洲中世纪家具。

现代弧线布艺沙发为本项目原创glTF，生成脚本scripts/build_sofa.mjs，含分体坐垫、靠包、靠枕、包边、木脚及本地织物法线；源贴图授权见app/public/textures/sources.json。其他床、厨卫、地毯和墙饰等为明确标注的参数模型。当前目录共25项，其中12项为glTF资产（11款外部CC0 + 1款原创）。资产本身不代表真实商品同款，风格覆盖仍需扩充。

来源：[Poly Haven](https://polyhaven.com/models)、[资产授权](https://polyhaven.com/license)。纹理与HDR继续使用本地PBR资源，窗外景观为示意。

## 验证与限制

运行npm --prefix app test、.venv/bin/python -m unittest discover -s backend/tests，以及npm --prefix app run build。陈设验收见docs/qa/2026-11-11-furnishing/verification.md，商品联动见docs/qa/2026-11-11-product-links/verification.md，天猫登录续读修复见docs/qa/2026-11-11-product-session/verification.md（当前后端50项、前端20项，共70项通过）。

商品动态页与本地登录浏览器需要执行一次`.venv/bin/python -m playwright install chromium`。商品记录、图片及GLB保存在`.runtime/products`，用户确认后的规格、来源、近似模型数据同时随项目存入IndexedDB；迁移时保留资源缓存。商品登录会话保存在本机专用browser-profile和权限受限的session/state.json，不应随公开源码或分享包发布。已实测公开商品页及用户登录后的一个天猫商品（9个SKU、指定款主图及图片标注尺寸）；不保证任意商城页面均可抓取。公开部署需另接商家授权API或用户隔离的远程登录方案。

当前户型仍以矩形近似，门窗与承重未完整还原；规则校验不代表施工或整条通道净宽已验证。参数物件和有限风格资产仍需优化；没有商城自动检索、厂家模型精确复刻、云端项目同步或生产部署。新旧页面端口/域名不同会使用不同浏览器存档，保存不是自动或云同步。

需求：[PRD.md](PRD.md) · 路由：[ROUTING.md](ROUTING.md) · 提示词：[PROMPTS.md](PROMPTS.md)。docs/archive与独立栖语-演示版.html为历史资料，不是当前工程运行入口。
