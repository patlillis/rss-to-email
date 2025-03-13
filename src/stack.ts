import { Api } from "sst/constructs";

export default function Stack({ stack }) {
    const api = new Api(stack, "Api", {
        routes: {
            "GET /": "functions/lambda.handler",
        },
    });
    stack.addOutputs({
        ApiEndpoint: api.url,
    });
}
