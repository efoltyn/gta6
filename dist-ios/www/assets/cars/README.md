# Player car assets

`ferrari.glb` is copied from the official Three.js `webgl_materials_car`
example:

- https://threejs.org/examples/webgl_materials_car.html
- https://threejs.org/examples/models/gltf/ferrari.glb

It is loaded only for the player's promoted vehicle. Ambient traffic keeps the
game's lightweight box rigs.

The other player-car styles are generated in `src/city/playercars.js`. Their
silhouettes are intentionally compact, game-native approximations so adding
garage variety does not add large model downloads.
