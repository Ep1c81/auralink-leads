import { previewRoute } from '@/lib/acquisitionRoute';
export const dynamic='force-dynamic';
export async function POST(req:Request){return previewRoute(req,'followup_2')}
export const GET=POST;
