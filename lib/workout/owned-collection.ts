import { NextResponse } from 'next/server';
import { generateId, getWorkoutData, updateWorkoutData } from '@/lib/workout/data';
import { ApiError, handleApiError, readJsonObject, requireWorkoutUserId, stripProtectedFields } from '@/lib/workout/api';

type OwnedRecord = Record<string, any> & { id: string; ownerId: string; isPublic?: boolean };

type OwnedCollectionConfig = {
  /** JSON file the collection is stored in, e.g. 'gyms.json'. */
  file: string;
  /** Top-level array key in that file, e.g. 'gyms'. */
  key: string;
  /** Singular name used in responses, e.g. 'gym'. */
  itemKey: string;
  /** Normalize a stored/merged record (applied on read and write). */
  normalize: (record: any) => any;
  /** Build the stored fields for a new record from the client payload. */
  buildNew: (payload: Record<string, any>) => Record<string, any>;
  /** Validate a record before it is saved; throw ApiError to reject. */
  validate?: (record: Record<string, any>) => void;
};

/**
 * CRUD handlers for a per-user collection with optional public sharing
 * (gyms, workout types). Owners can edit/delete their records; anyone
 * logged in can read public ones with `?scope=all`.
 */
export function createOwnedCollectionHandlers(config: OwnedCollectionConfig) {
  const defaultData = () => ({ [config.key]: [] as OwnedRecord[] });
  const getList = (data: Record<string, any>): OwnedRecord[] =>
    Array.isArray(data[config.key]) ? data[config.key] : (data[config.key] = []);

  async function GET(request: Request) {
    try {
      const userId = await requireWorkoutUserId();
      const data = await getWorkoutData<Record<string, any>>(config.file, defaultData());
      const { searchParams } = new URL(request.url);
      const includePublic = searchParams.get('scope') === 'all';

      const items = getList(data)
        .map(config.normalize)
        .filter((item: OwnedRecord) => item.ownerId === userId || (includePublic && item.isPublic));

      return NextResponse.json({ success: true, [config.key]: items });
    } catch (error) {
      return handleApiError(error, `List ${config.key} failed`);
    }
  }

  async function POST(request: Request) {
    try {
      const userId = await requireWorkoutUserId();
      const payload = await readJsonObject(request);

      const created = await updateWorkoutData(config.file, defaultData(), (data) => {
        const record = config.normalize({
          ...config.buildNew(payload),
          id: generateId(),
          ownerId: userId,
          isPublic: payload.isPublic === true,
          createdAt: new Date().toISOString(),
        });
        config.validate?.(record);
        getList(data).push(record);
        return record;
      });

      return NextResponse.json({ success: true, [config.itemKey]: created });
    } catch (error) {
      return handleApiError(error, `Create ${config.itemKey} failed`);
    }
  }

  async function PUT(request: Request) {
    try {
      const userId = await requireWorkoutUserId();
      const payload = await readJsonObject(request);
      if (!payload.id) throw new ApiError(400, 'ID missing');

      const updated = await updateWorkoutData(config.file, defaultData(), (data) => {
        const list = getList(data);
        const index = list.findIndex((item) => item.id === payload.id);
        if (index === -1) throw new ApiError(404, 'Not found');
        if (list[index].ownerId !== userId) throw new ApiError(403, 'Forbidden');

        // Never let the client rewrite identity/ownership fields.
        const record = config.normalize({
          ...list[index],
          ...stripProtectedFields(payload),
          updatedAt: new Date().toISOString(),
        });
        config.validate?.(record);
        list[index] = record;
        return record;
      });

      return NextResponse.json({ success: true, [config.itemKey]: updated });
    } catch (error) {
      return handleApiError(error, `Update ${config.itemKey} failed`);
    }
  }

  async function DELETE(request: Request) {
    try {
      const userId = await requireWorkoutUserId();
      const id = new URL(request.url).searchParams.get('id');
      if (!id) throw new ApiError(400, 'ID missing');

      await updateWorkoutData(config.file, defaultData(), (data) => {
        const list = getList(data);
        const item = list.find((entry) => entry.id === id);
        if (!item) throw new ApiError(404, 'Not found');
        if (item.ownerId !== userId) throw new ApiError(403, 'Forbidden');
        data[config.key] = list.filter((entry) => entry.id !== id);
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      return handleApiError(error, `Delete ${config.itemKey} failed`);
    }
  }

  return { GET, POST, PUT, DELETE };
}
