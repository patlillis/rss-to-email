import { Client } from "pg";

export const handler = async (event) => {
    const client = new Client({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || "5432"),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    });

    await client.connect();

    // Your database logic here

    await client.end();

    return {
        statusCode: 200,
        body: JSON.stringify({
            message: "Hello from Lambda!",
        }),
    };
};
