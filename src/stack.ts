import { Api, StackContext } from "sst/constructs";

export default function Stack({ stack }: StackContext) {
    const api = new Api(stack, "Api", {
        routes: {
            "GET /": "functions/lambda.handler",
        },
    });
    stack.addOutputs({
        ApiEndpoint: api.url,
    });
}
