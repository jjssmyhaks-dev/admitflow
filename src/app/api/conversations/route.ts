import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ ok: true, list: [] }, { status: 200 });
}

export async function POST() {
  return NextResponse.json({ ok: true, created: {} }, { status: 201 });
}
