import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      status: "placeholder",
      message: "The server-side conversation agent is not implemented in this starter skeleton.",
    },
    { status: 501 },
  );
}

