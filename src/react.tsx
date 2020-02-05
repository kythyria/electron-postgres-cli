import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as Repl from './repl';
import * as pg from 'pg';

let connection : pg.Client;

(async() => {
    connection = new pg.Client({
        host: "localhost",
        port: 5432,
        user: "kythyria",
        database: "kythyria"
    });

    await connection.connect();
     
    const Index = () => {
        return <>
            <div>Hello React!</div>
            <Repl.REPL connection={connection}/>
        </>;
    };
     
    ReactDOM.render(<Index />, document.getElementById('app'));
})();