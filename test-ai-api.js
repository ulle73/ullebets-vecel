/**
 * Test script for /api/ai/generate-user endpoint
 * Run: node test-ai-api.js
 */

const date = process.argv[2] || "2025-12-02";

console.log(`Testing /api/ai/generate-user with date: ${date}`);

fetch('http://localhost:3000/api/ai/generate-user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ date }),
})
  .then(res => res.json())
  .then(data => {
    console.log('\n✅ API Response:');
    console.log(JSON.stringify(data, null, 2));
  })
  .catch(error => {
    console.error('\n❌ Error:', error.message);
  });
