import { NextResponse } from 'next/server';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json({error:'Discovery paused'},{status:503})}
export const POST=GET;
