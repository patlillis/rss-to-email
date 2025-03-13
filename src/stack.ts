import { StackContext, Function, Cron } from "sst/constructs";
import * as rds from 'aws-cdk-lib/aws-rds';
import { RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";

export default function Stack({ stack }: StackContext) {
    const vpc = new ec2.Vpc(stack, 'VPC');

    // Create an Aurora Serverless v2 instance
    const db = new rds.DatabaseCluster(stack, 'Cluster', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_17_2 }),
        removalPolicy: RemovalPolicy.RETAIN,
        iamAuthentication: true,
        vpc,
    });

    // Create a Lambda function with permissions to access the RDS instance
    const lambdaFunction = new Function(stack, "LambdaFunction", {
        handler: "src/lambda.handler",
        environment: {
            DB_ARN: db.clusterArn, // Add the ARN of the database cluster
            DB_SECRET_ARN: db.secret?.secretArn || "", // Add the ARN of the secret
            DB_NAME: "mydb",
        },
    });

    // Grant the Lambda function permissions to access the database
    db.grantDataApiAccess(lambdaFunction);

    // Create a cron job to run the Lambda function once a day at midnight
    // new Cron(stack, "DailyCron", {
    //     schedule: "rate(1 day)",
    //     job: lambdaFunction,
    // });
}
