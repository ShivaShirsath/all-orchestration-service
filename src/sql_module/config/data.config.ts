import path from "path";
import { DataSource } from "typeorm"
import * as dotenv from 'dotenv';
dotenv.config();

const SQL_DB_TYPE: any = process.env.SQL_DB_TYPE || 'mysql';
const SQL_PORT: any = process.env.SQL_PORT || 3306;

export const myDataSource = new DataSource({
    type: SQL_DB_TYPE,
    host: process.env.SQL_HOST,
    port: SQL_PORT,
    username: process.env.SQL_USERNAME,
    password: process.env.SQL_PASSWORD,
    database: process.env.SQL_DATABASE_NAME,
    // Resolved from this file's folder so it works both under ts-node (.ts)
    // and when running the compiled build from dist/ (.js).
    entities: [path.join(__dirname, "../schema/*.{ts,js}")],
    logging: false,
    // Schema auto-sync on every worker start. Default unchanged (true); set
    // TYPEORM_SYNCHRONIZE=false in production once the schema is stable.
    synchronize: process.env.TYPEORM_SYNCHRONIZE !== 'false',
});