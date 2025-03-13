import { SSTConfig } from "sst";

export default {
    config() {
        return {
            name: "rss-to-email",
            region: "us-east-1",
        };
    },
    stacks(app) { },
} satisfies SSTConfig;