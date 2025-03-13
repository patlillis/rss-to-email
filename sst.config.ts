import { SSTConfig } from "sst";
import Stack from "./src/stack";

export default {
    config() {
        return {
            name: "rss-to-email",
            region: "us-east-1",
        };
    },
    stacks(app) {
        app.stack(Stack);
    },
} satisfies SSTConfig;
