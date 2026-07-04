# Three.js r185 — authoritative symbol index

The complete public surface of **r185** (latest, ~Jul 2026), from the official docs index. Use it to confirm a symbol exists and what it's called **now** — if a name you remember isn't here, it was renamed/removed (see `MIGRATION.md`). Grep this file for a symbol before asserting it exists.

Note: much of the `Nodes` / `Renderers` (WebGPU) / `TSL` surface **did not exist in r128** — never write these into this repo's r128 code.

---

## CORE (`import * as THREE from 'three'`)

**Animation:** AnimationAction, AnimationClip, AnimationMixer, AnimationObjectGroup, AnimationUtils, BooleanKeyframeTrack, ColorKeyframeTrack, KeyframeTrack, NumberKeyframeTrack, PropertyBinding, PropertyMixer, QuaternionKeyframeTrack, StringKeyframeTrack, VectorKeyframeTrack

**Audio:** Audio, AudioAnalyser, AudioContext, AudioListener, PositionalAudio

**Cameras:** ArrayCamera, Camera, CubeCamera, OrthographicCamera, PerspectiveCamera, StereoCamera

**Core:** BufferAttribute, BufferGeometry, Clock, EventDispatcher, Float16BufferAttribute, Float32BufferAttribute, GLBufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, Int16/32/8BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute, Layers, Object3D, Raycaster, RenderTarget, RenderTarget3D, Timer, Uint16/32/8BufferAttribute, Uint8ClampedBufferAttribute, Uniform, UniformsGroup

**Extras:** ArcCurve, CatmullRomCurve3, Controls, CubicBezierCurve(3), Curve, CurvePath, DataUtils, Earcut, EllipseCurve, ImageUtils, LineCurve(3), PMREMGenerator, Path, QuadraticBezierCurve(3), Shape, ShapePath, ShapeUtils, SplineCurve, TextureUtils, Interpolations

**Geometries:** Box, Capsule, Circle, Cone, Cylinder, Dodecahedron, Edges, Extrude, Icosahedron, Lathe, Octahedron, Plane, Polyhedron, Ring, Shape, Sphere, Tetrahedron, Torus, TorusKnot, Tube, Wireframe — all `*Geometry`

**Helpers:** Arrow, Axes, Box3, Box, Camera, DirectionalLight, Grid, HemisphereLight, Plane, PointLight, PolarGrid, Skeleton, SpotLight — all `*Helper`

**Lights:** AmbientLight, DirectionalLight, DirectionalLightShadow, HemisphereLight, IESSpotLight, Light, LightProbe, LightShadow, PointLight, PointLightShadow, ProjectorLight, RectAreaLight, SpotLight, SpotLightShadow

**Loaders (core):** AnimationLoader, AudioLoader, BufferGeometryLoader, Cache, CompressedTextureLoader, CubeTextureLoader, DataTextureLoader, FileLoader, ImageBitmapLoader, ImageLoader, Loader, LoaderUtils, LoadingManager, MaterialLoader, NodeLoader, NodeMaterialLoader, NodeObjectLoader, ObjectLoader, TextureLoader

**Materials:** MeshBasicMaterial, MeshDepthMaterial, MeshDistanceMaterial, MeshLambertMaterial, MeshMatcapMaterial, MeshNormalMaterial, MeshPhongMaterial, MeshPhysicalMaterial, MeshStandardMaterial, MeshToonMaterial, LineBasicMaterial, LineDashedMaterial, PointsMaterial, RawShaderMaterial, ShaderMaterial, ShadowMaterial, SpriteMaterial, Material. **Node variants** (WebGPU): `*NodeMaterial` (MeshStandardNodeMaterial, MeshPhysicalNodeMaterial, NodeMaterial, LineBasicNodeMaterial, PointsNodeMaterial, SpriteNodeMaterial, VolumeNodeMaterial, MeshSSSNodeMaterial, MeshToonNodeMaterial, …), NodeMaterialObserver, SSSLightingModel

**Math:** BezierInterpolant, Box2, Box3, Color, CubicInterpolant, Cylindrical, DiscreteInterpolant, Euler, Frustum, FrustumArray, Interpolant, Line3, LinearInterpolant, MathUtils, Matrix2/3/4, Plane, Quaternion, QuaternionLinearInterpolant, Ray, Sphere, Spherical, SphericalHarmonics3, Triangle, Vector2/3/4

**Objects:** BatchedMesh, Bone, ClippingGroup, Group, InstancedMesh, LOD, Line, LineLoop, LineSegments, Mesh, Points, Skeleton, SkinnedMesh, Sprite

**Renderers:** WebGLRenderer, WebGLRenderTarget, WebGL3DRenderTarget, WebGLArrayRenderTarget, WebGLCubeRenderTarget, **WebGPURenderer**, Renderer, Backend, PostProcessing, RenderPipeline, QuadMesh, CubeRenderTarget, Info, StorageTexture (+ Storage3DTexture, StorageArrayTexture), StorageBufferAttribute, TimestampQueryPool, WGSL/GLSLNodeBuilder, WebXRManager, XRManager, UniformsUtils

**Scenes:** Fog, FogExp2, Scene

**Textures:** CanvasTexture, CompressedArrayTexture, CompressedCubeTexture, CompressedTexture, CubeDepthTexture, CubeTexture, Data3DTexture, DataArrayTexture, DataTexture, DepthTexture, ExternalTexture, FramebufferTexture, HTMLTexture, Source, Texture, VideoFrameTexture, VideoTexture

**Nodes** (WebGPU node system, `three/webgpu` — large; representative): AttributeNode, TextureNode, UniformNode, MaterialNode, OperatorNode, MathNode, FunctionNode, LoopNode, PassNode, ShadowNode, PMREMNode, and ~150 more `*Node` classes. Confirm exact node names against threejs.org/docs.

---

## ADDONS (`import { X } from 'three/addons/...'`; was `examples/jsm`)

**Controls:** ArcballControls, DragControls, FirstPersonControls, FlyControls, MapControls, OrbitControls, PointerLockControls, TrackballControls, TransformControls

**Loaders:** GLTFLoader, DRACOLoader, FBXLoader, OBJLoader, MTLLoader, ColladaLoader, STLLoader, PLYLoader, SVGLoader, KTX2Loader, **HDRLoader** (was RGBELoader), EXRLoader, **USDLoader** (USDZLoader deprecated), TGALoader, TIFFLoader, LDrawLoader, 3DM/Rhino3dmLoader, VOXLoader, VRMLLoader, VTKLoader (deprecated), LWOLoader, PCDLoader, BVHLoader, FontLoader, Font, UltraHDRLoader, MaterialXLoader, and more

**Postprocessing (WebGL EffectComposer):** EffectComposer, RenderPass, ShaderPass, **OutputPass**, UnrealBloomPass, BloomPass, BokehPass, GTAOPass, SAOPass, SSAOPass, SSRPass, SMAAPass, FXAAPass, TAARenderPass, SSAARenderPass, FilmPass, GlitchPass, HalftonePass, DotScreenPass, AfterimagePass, LUTPass, MaskPass, OutlinePass, RenderPixelatedPass, TexturePass, SavePass, Pass, FullScreenQuad

**Objects/Geometries:** Sky, SkyMesh, Water, WaterMesh, Reflector, Refractor, Lensflare, MarchingCubes, GroundedSkybox, ShadowMesh, RoundedBoxGeometry, TextGeometry, ConvexGeometry, DecalGeometry, ParametricGeometry, TeapotGeometry, Line2/LineGeometry/LineMaterial (fat lines)

**Utils:** BufferGeometryUtils, SkeletonUtils, SceneUtils, CameraUtils, GeometryUtils, GeometryCompressionUtils, SceneOptimizer, WorkerPool, ColorUtils

**Math:** Capsule, ConvexHull, ImprovedNoise, SimplexNoise, MeshSurfaceSampler, OBB, Octree, Lut, ColorConverter

**Physics:** AmmoPhysics, JoltPhysics, RapierPhysics (+ RapierHelper)

**Environments:** RoomEnvironment, DebugEnvironment, ColorEnvironment

**Exporters:** GLTFExporter, DRACOExporter, EXRExporter, KTX2Exporter, OBJExporter, PLYExporter, STLExporter, USDZExporter

**Renderers (alt):** CSS2DRenderer/CSS2DObject, CSS3DRenderer/CSS3DObject/CSS3DSprite, SVGRenderer

**WebXR:** VRButton, ARButton, XRButton, XRControllerModelFactory, XRHandModelFactory, OculusHandModel

**Capabilities:** WebGL, WebGPU

---

## TSL (`import { ... } from 'three/tsl'`) — node shading language, r171+

Control: If, Loop, Break, Continue, Return, Switch, Const, Var, Discard, Fn-style. Constants: PI, PI2, TWO_PI, HALF_PI, EPSILON, INFINITY.

Hundreds of node functions incl.: uv, texture, texture3D, cubeTexture, attribute, uniform, uniformArray, varying, vertexStage, positionLocal/World/View, normalLocal/World/View, cameraPosition/ProjectionMatrix/ViewMatrix, modelViewMatrix, screenUV, viewportUV (was viewportTopLeft), color/space nodes, math (abs, sin, cos, pow, mix, clamp, smoothstep, dot, cross, normalize, length, reflect, refract, fract, mod, step, saturate, …), blend (blendBurn/blendDodge/blendScreen/blendOverlay — renamed from burn/dodge/screen/overlay r171), material* accessors (materialColor, materialRoughness, materialMetalness, materialNormal, …), post nodes (bloom, fxaa, smaa, ssr, ssgi, gtao, dof, motionBlur, vignette, sepia, sobel, pixelationPass, …), compute/storage (instancedArray, storage, atomicAdd, workgroupArray, subgroup*), toneMapping (acesFilmicToneMapping, agxToneMapping, neutralToneMapping, …).

Confirm exact TSL function names against threejs.org/docs — this namespace churns fastest.

---

## GLOBAL CONSTANTS (`THREE.*`)

**Color space (r152+):** SRGBColorSpace, LinearSRGBColorSpace, NoColorSpace, SRGBTransfer, LinearTransfer. *(r128 used sRGBEncoding / LinearEncoding instead.)*

**Tone mapping:** NoToneMapping, LinearToneMapping, ReinhardToneMapping, CineonToneMapping, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, CustomToneMapping

**Side:** FrontSide, BackSide, DoubleSide

**Blending:** NoBlending, NormalBlending, AdditiveBlending, SubtractiveBlending, MultiplyBlending, CustomBlending (+ blend equations/factors)

**Shadow maps:** BasicShadowMap, PCFShadowMap, PCFSoftShadowMap (deprecated r181), VSMShadowMap

**Wrapping:** RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping

**Filters:** NearestFilter, LinearFilter, + mipmap variants

**Formats:** RGBAFormat, RedFormat, RGFormat, DepthFormat, DepthStencilFormat, AlphaFormat, integer + compressed (ASTC/BPTC/ETC/S3TC/PVRTC) variants. **RGBFormat is GONE (removed r137)** — r128 still has it.

**Types:** UnsignedByteType, ByteType, ShortType, UnsignedShortType, IntType, UnsignedIntType, FloatType, HalfFloatType, + packed short/int variants

**Coordinate systems:** WebGLCoordinateSystem, WebGPUCoordinateSystem

**Draw/usage/stencil/depth/cull:** Static/Dynamic/StreamDrawUsage, stencil ops & funcs, depth funcs, CullFace*, animation blend modes, interpolation modes, mapping modes (UVMapping, CubeReflectionMapping, Equirectangular*, etc.)

*(Full constant list preserved from the r185 docs dump; grep here for any specific constant.)*
