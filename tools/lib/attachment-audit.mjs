import { OBB } from "three/addons/math/OBB.js";
import { Matrix4, Vector3 } from "three";

const localCenter = new Vector3();
const localSize = new Vector3();
const centerMatrix = new Matrix4();
const centerTranslation = new Matrix4();

// Convert any authored THREE.Object3D assembly into the source boxes consumed
// by CBZ.reality.supportAudit. OBBs preserve the real solid after rotations;
// AABBs remain only the shared tool's cheap broad phase.
export function objectParts(root, options = {}) {
  if (!root || typeof root.traverse !== "function") throw new Error("attachment audit needs an Object3D root");
  const kind = options.kind || root.name || "assembly";
  const prefix = options.prefix || kind;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || (options.ignore && options.ignore(mesh))) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (!local) throw new Error(`${mesh.name || prefix + ":part-" + parts.length} needs geometry bounds`);
    const worldAabb = local.clone().applyMatrix4(mesh.matrixWorld);
    // OBB.applyMatrix4 in Three's addon rotates/scales halfSize and adds the
    // matrix translation, but it does not transform a pre-existing non-zero
    // center. Most wildlife BoxGeometry is centred at zero; merged hair,
    // vehicle shells and other authored geometries are often pre-translated.
    // Move that local centre into the matrix and start the OBB at the origin so
    // both families use the same correct world solid.
    local.getCenter(localCenter);
    local.getSize(localSize).multiplyScalar(0.5);
    centerTranslation.makeTranslation(localCenter.x, localCenter.y, localCenter.z);
    centerMatrix.multiplyMatrices(mesh.matrixWorld, centerTranslation);
    const obb = new OBB(new Vector3(), localSize.clone()).applyMatrix4(centerMatrix);
    parts.push({
      id: mesh.name || `${prefix}:part-${parts.length}`,
      kind,
      object: mesh,
      anchor: mesh.userData && mesh.userData.attachmentRoot === true,
      minX: worldAabb.min.x,
      maxX: worldAabb.max.x,
      minY: worldAabb.min.y,
      maxY: worldAabb.max.y,
      minZ: worldAabb.min.z,
      maxZ: worldAabb.max.z,
      volume: 8 * obb.halfSize.x * obb.halfSize.y * obb.halfSize.z,
      obb,
    });
  });
  if (!parts.length) throw new Error(`${kind} should build visible physical parts`);

  const declared = parts.filter((part) => part.anchor);
  if (declared.length > 1 && !options.allowMultipleAnchors) {
    throw new Error(`${kind} declares multiple attachment roots`);
  }
  if (!declared.length) {
    const eligible = options.anchorWhere ? parts.filter(options.anchorWhere) : parts;
    if (!eligible.length) throw new Error(`${kind} has no eligible attachment anchor`);
    let anchor = eligible[0];
    for (let i = 1; i < eligible.length; i++) if (eligible[i].volume > anchor.volume) anchor = eligible[i];
    anchor.anchor = true;
  }
  return parts;
}

export function touchingObbs(a, b, _broadA, _broadB, contactEps) {
  // Grow each solid by half the permitted seam tolerance. This accepts tiny
  // authored joins without converting a visibly detached part into an edge.
  const pad = contactEps * 0.5;
  const left = a.obb.clone();
  const right = b.obb.clone();
  left.halfSize.addScalar(pad);
  right.halfSize.addScalar(pad);
  return left.intersectsOBB(right, 1e-10);
}

export function auditObject(reality, root, options = {}) {
  const parts = objectParts(root, options);
  const result = reality.supportAudit(parts, {
    cell: options.cell || 0.5,
    contactEps: options.contactEps == null ? 0.015 : options.contactEps,
    touches: options.touches || touchingObbs,
    sampleLimit: options.sampleLimit,
    componentSampleLimit: options.componentSampleLimit,
  });
  return { ...result, parts };
}

export function belongsTo(object, ancestor) {
  for (let node = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}
