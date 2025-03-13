import { SSTConfig } from "sst";
import { Api } from "sst/constructs";

export default {
    config() {
        return {
            name: "rss-to-email",
            region: "us-east-1",
        };
    },
    stacks(app) {
        app.stack(function Stack() {
            const api = new Api(this, "Api", {
                routes: {
                    "GET /": "functions/lambda.handler",
                },
            });
            this.addOutputs({
                ApiEndpoint: api.url,
            });
        });
    },
} satisfies SSTConfig;
