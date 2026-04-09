import * as assert from 'assert';
import {
    BranchesTreeProvider,
    BranchItem,
    BranchesClient,
    MoonshotBranch,
    HttpBranchesClient,
} from '../../branchesTree';

class StubClient implements BranchesClient {
    constructor(private readonly result: MoonshotBranch[] | Error) {}
    baseUrl(): string { return 'http://stub'; }
    async listBranches(): Promise<MoonshotBranch[]> {
        if (this.result instanceof Error) { throw this.result; }
        return this.result;
    }
}

suite('Moonshot Branches Tree', () => {
    test('shows hint when no client configured', async () => {
        const p = new BranchesTreeProvider();
        const items = await p.getChildren();
        assert.strictEqual(items.length, 1);
        assert.ok(items[0].label?.toString().includes('no Moonshot URL'));
    });

    test('lists branches from client', async () => {
        const p = new BranchesTreeProvider();
        p.setClient(new StubClient([
            { name: 'main' },
            { name: 'exp', parent: 'main', createdAtMs: 1234 },
        ]));
        const items = await p.getChildren();
        assert.strictEqual(items.length, 2);
        assert.strictEqual(items[0].label, 'main');
        assert.strictEqual(items[1].label, 'exp');
        assert.ok((items[1].description as string).includes('parent: main'));
    });

    test('shows empty hint when broker returns no branches', async () => {
        const p = new BranchesTreeProvider();
        p.setClient(new StubClient([]));
        const items = await p.getChildren();
        assert.strictEqual(items.length, 1);
        assert.ok(items[0].label?.toString().includes('no branches'));
    });

    test('surfaces errors to the tree', async () => {
        const p = new BranchesTreeProvider();
        p.setClient(new StubClient(new Error('boom')));
        const items = await p.getChildren();
        assert.strictEqual(items.length, 1);
        assert.ok(items[0].label?.toString().includes('Error: boom'));
        assert.strictEqual(items[0].contextValue, 'moonshotError');
    });

    test('child of a branch returns no further children', async () => {
        const p = new BranchesTreeProvider();
        const item = new BranchItem({ name: 'main' });
        const sub = await p.getChildren(item);
        assert.deepStrictEqual(sub, []);
    });

    test('refresh fires change event', () => {
        const p = new BranchesTreeProvider();
        let fired = false;
        p.onDidChangeTreeData(() => { fired = true; });
        p.refresh();
        assert.ok(fired);
    });

    test('HttpBranchesClient builds correct URL and parses response', async () => {
        const calls: { url: string; headers: any }[] = [];
        const fakeFetch = (async (url: any, init?: any) => {
            calls.push({ url: url.toString(), headers: init?.headers || {} });
            return {
                ok: true,
                json: async () => ({ branches: [{ name: 'main' }] }),
            } as any;
        }) as unknown as typeof fetch;
        const c = new HttpBranchesClient('http://localhost:9094/', 'tok', fakeFetch);
        const got = await c.listBranches();
        assert.strictEqual(got.length, 1);
        assert.strictEqual(got[0].name, 'main');
        assert.strictEqual(calls[0].url, 'http://localhost:9094/api/v1/branches');
        assert.strictEqual((calls[0].headers as any)['Authorization'], 'Bearer tok');
    });

    test('HttpBranchesClient throws on non-2xx', async () => {
        const fakeFetch = (async () => ({
            ok: false,
            status: 500,
            text: async () => 'oops',
        } as any)) as unknown as typeof fetch;
        const c = new HttpBranchesClient('http://x', undefined, fakeFetch);
        await assert.rejects(c.listBranches(), /HTTP 500/);
    });
});
