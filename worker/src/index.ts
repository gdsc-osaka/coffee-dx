export interface Env {
    // ここにKVやD1などのバインディング型を追加します
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        return new Response("Hello, Coffee DX!");
    },
};
