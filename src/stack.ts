import { Api, StackContext, RDS, Function, Cron } from "sst/constructs";
import { handler } from "./lambda";

export default function Stack({ stack }: StackContext) {
    // Create an RDS Aurora v2 instance
    const db = new RDS(stack, "Database", {
        engine: "aurora-postgresql",
        defaultDatabaseName: "mydb",
        migrations: "src/migrations",
    });

    // Create a Lambda function with permissions to access the RDS instance
    const lambdaFunction = new Function(stack, "LambdaFunction", {
        handler: "src/lambda.handler",
        environment: {
            DB_HOST: db.clusterEndpoint.hostname,
            DB_PORT: db.clusterEndpoint.port,
            DB_NAME: "mydb",
            DB_USER: "admin",
            DB_PASSWORD: db.secret?.secretValueFromJson("password") || "",
        },
    });

    // Grant the Lambda function permissions to access the database
    db.grantDataApiAccess(lambdaFunction);

    // Create a cron job to run the Lambda function once a day at midnight
    new Cron(stack, "DailyCron", {
        schedule: "rate(1 day)",
        job: lambdaFunction,
    });

    const api = new Api(stack, "Api", {
        routes: {
            "GET /": handler,
        },
    });
    stack.addOutputs({
        ApiEndpoint: api.url,
        DatabaseEndpoint: db.clusterEndpoint.hostname,
    });
}
