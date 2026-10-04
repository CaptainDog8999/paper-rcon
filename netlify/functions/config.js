exports.handler = async function handler() {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ googleClientId: process.env.GOOGLE_CLIENT_ID || "" }),
  };
};
