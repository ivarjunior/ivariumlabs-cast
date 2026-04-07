export async function GET() {
  return new Response("Gebruik een tenant-specifieke feedroute.", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
