import { RDSDataService } from "aws-sdk";

const rdsData = new RDSDataService();

export const handler = async (event) => {
    const params = {
        resourceArn: process.env.DB_ARN, // Add the ARN of the database cluster
        secretArn: process.env.DB_SECRET_ARN, // Add the ARN of the secret
        sql: "SELECT * FROM your_table_name LIMIT 1;", // Replace with your actual table name
        database: "mydb",
    };

    try {
        const result = await rdsData.executeStatement(params).promise();
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Query executed successfully!",
                data: result,
            }),
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Error executing query",
                error: error.message,
            }),
        };
    }
};
