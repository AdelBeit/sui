import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';

const SANDBOX_ID = 'f616951a-4868-489e-80c3-cd47a5609692';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'admin@example.com';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'pancake1!';
const PB_URL = 'http://127.0.0.1:8090';

async function run(sandbox: Awaited<ReturnType<Daytona['get']>>, cmd: string) {
  const res = await sandbox.process.executeCommand(cmd);
  return res.result ?? (res as any).artifacts?.stdout ?? '';
}

async function main() {
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API, apiUrl: 'https://app.daytona.io/api' });
  const sandbox = await daytona.get(SANDBOX_ID);

  // Get admin token
  const tokenJson = await run(sandbox,
    `curl -s -X POST ${PB_URL}/api/collections/_superusers/auth-with-password -H 'Content-Type: application/json' -d '{"identity":"${PB_ADMIN_EMAIL}","password":"${PB_ADMIN_PASSWORD}"}'`
  );
  const token = JSON.parse(tokenJson).token as string;
  console.log(`Got token: ${token.slice(0, 20)}...`);

  // Open permissions on each collection
  for (const coll of ['customers', 'invoices', 'charges', 'generated_views']) {
    const idJson = await run(sandbox, `curl -s -H 'Authorization: ${token}' ${PB_URL}/api/collections/${coll}`);
    const id = JSON.parse(idJson).id as string;
    const result = await run(sandbox,
      `curl -s -X PATCH ${PB_URL}/api/collections/${id} -H 'Content-Type: application/json' -H 'Authorization: ${token}' -d '{"listRule":"","viewRule":"","createRule":"","updateRule":"","deleteRule":""}'`
    );
    const name = JSON.parse(result).name;
    console.log(`Opened: ${name}`);
  }

  console.log('All collections are now publicly accessible.');
}

main().catch(console.error);
