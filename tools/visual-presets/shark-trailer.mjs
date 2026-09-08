/* Shark Sim — the PREVIEW VIDEO, recorded by the engine one fixed step per
   frame (ba's `video` subject hook), so nothing is sped up or dropped however
   loaded the box is. 16 s at 24 fps; the first half second holds the 16:9
   cover so the portal's "static cover as the opening frame" rule is met.
     ba shark-trailer --before local --after http://127.0.0.1:8644/ --only after --width 1920 --height 1080 ...
     ba shark-trailer ... --width 1080 --height 1620      (the 2:3 portrait cut) */
import product from './shark-product.mjs';
export default {
  ...product,
  id: 'shark-trailer',
  title: 'Shark Sim — real-time gameplay preview',
  subjects: product.subjects.filter((s) => s.id === 'cover-white').map((s) => ({ ...s, id: 'trailer', label: 'Sixteen seconds of the ride', video: { fps: 24, seconds: 16 } })),
};
