import { NextResponse } from 'next/server';
import { db } from '@/db';
import { assets } from '@/db/schema';
import { getUser, ownerBusiness, uid } from '@/lib/auth';
import { requireMembership, roleAllowed } from '@/lib/tenancy';
import { validateUpload, sha256Hex, FORMAT_EXT, MAX_UPLOAD_BYTES } from '@/lib/media-validation';
import { storagePut, storageDelete, storageMove } from '@/lib/storage';
import { scanForMalware } from '@/lib/av-scan';
import type { assetKind } from '@/db/schema';

type AssetKind = (typeof assetKind.enumValues)[number];

// Which kinds a given upload format may claim via the optional `kind`
// form field. Defaults: images -> photo, GLB -> model-source.
const IMAGE_KINDS: AssetKind[] = ['photo', 'poster', 'logo', 'cover'];
const MODEL_KINDS: AssetKind[] = ['model-source', 'model-high', 'model-low', 'model-usdz'];

// Upload flow (Phase 2, fixes S5):
//   validate by magic bytes -> write to a QUARANTINE key -> AV-scan hook ->
//   promote to the final key -> insert the metadata row.
// The file never touches the database; the row stores metadata + key only.
// The response keeps the Phase 1 shape ({ url }) so the dashboard's
// product form is unchanged; id/kind/bytes/sha256 are additive.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  // Phase 6 role gate: staff cannot upload media (availability only).
  // Owners/managers resolve through their membership; a user with no
  // restaurant keeps flowing to the ownerBusiness check below.
  const membership = await requireMembership();
  if (membership && !roleAllowed(membership.role, 'manager')) return NextResponse.json({ error: 'Your role does not allow uploads. Ask the owner or a manager.' }, { status: 403 });
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file to upload.' }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Choose a file under 20 MB.' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateUpload(buffer);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const requestedKind = form.get('kind');
  const allowedKinds = validation.isModel ? MODEL_KINDS : IMAGE_KINDS;
  const kind: AssetKind =
    typeof requestedKind === 'string' && (allowedKinds as string[]).includes(requestedKind)
      ? (requestedKind as AssetKind)
      : validation.isModel
        ? 'model-source'
        : 'photo';

  const id = uid();
  const ext = FORMAT_EXT[validation.format];
  const quarantineKey = `quarantine/${user.id}/${id}.${ext}`;
  const finalKey = `assets/${user.id}/${id}.${ext}`;

  try {
    await storagePut(quarantineKey, buffer);
    const scan = await scanForMalware(buffer, file.name);
    if (scan.status === 'infected') {
      await storageDelete(quarantineKey).catch(() => {});
      return NextResponse.json({ error: 'This file was rejected by the malware scan.' }, { status: 400 });
    }
    if (scan.status === 'unavailable') {
      // A configured scanner that cannot be reached fails CLOSED: keep the
      // bytes quarantined for inspection, create no asset, tell the owner.
      console.error('[assets] AV scanner unavailable; upload held in quarantine:', quarantineKey, scan.detail);
      return NextResponse.json({ error: 'Upload scanning is temporarily unavailable. Please try again shortly.' }, { status: 503 });
    }
    await storageMove(quarantineKey, finalKey);
  } catch (e) {
    console.error('[assets] storage error during upload:', e);
    return NextResponse.json({ error: 'Could not store that file. Please try again.' }, { status: 500 });
  }

  const business = await ownerBusiness();
  const sha256 = sha256Hex(buffer);
  await db.insert(assets).values({
    id,
    ownerId: user.id,
    businessId: business?.id ?? null,
    kind,
    storageKey: finalKey,
    mime: validation.mime,
    bytes: buffer.length,
    width: validation.dimensions?.width ?? null,
    height: validation.dimensions?.height ?? null,
    sha256,
    status: 'ready',
  });
  return NextResponse.json({ url: '/api/assets/' + id, id, kind, bytes: buffer.length, sha256 });
}
