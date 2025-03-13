import { Api, StackContext } from "sst/constructs";
import { handler } from "./lambda";

export default function Stack({ stack }: StackContext) {
    const api = new Api(stack, "Api", {
        routes: {
            "GET /": handler,
        },
    });
    stack.addOutputs({
        ApiEndpoint: api.url,
    });
}
