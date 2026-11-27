import { previewRoute } from '@/lib/acquisitionRoute';
export const dynamic='force-dynamic';
export async function POST(req:Request){return previewRoute(req,'pitch_1')}
export const GET=POST;
