import { Api, StackContext, Function, Cron } from "sst/constructs";
import { DatabaseCluster, DatabaseClusterEngine, Credentials } from "aws-cdk-lib/aws-rds";
import { handler } from "./lambda";
import { RemovalPolicy } from "aws-cdk-lib";

export default function Stack({ stack }: StackContext) {
    // Create an Aurora Serverless v2 instance
    const db = new DatabaseCluster(stack, "Database", {
        engine: DatabaseClusterEngine.auroraPostgres({
            version: "2.0.0", // Specify the version for Aurora Serverless v2
        }),
        credentials: Credentials.fromGeneratedSecret("admin"),
        defaultDatabaseName: "mydb",
        removalPolicy: RemovalPolicy.DESTROY, // Change to RETAIN for production
        serverlessCluster: true,
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
