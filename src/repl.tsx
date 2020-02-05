import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as pg from 'pg';
import * as util from 'util';

interface ServerMessage extends Error {
    // BUG: On non-english servers this might be wrong
    // see https://www.postgresql.org/docs/current/protocol-error-fields.html
    // but node-postgres uses S (which is localised) rather than V (which isn't)
    severity: "ERROR" | "FATAL" | "PANIC" | "WARNING" | "NOTICE" | "DEBUG" | "INFO" | "LOG";
    code: string;
    detail?: string;
    hint?: string;
    position?: string;
    internalPosition?: string;
    internalQuery?: string;
    where?: string;
    schema?: string;
    table?: string;
    column?: string;
    dataType?: string;
    constraint?: string;
    file?: string;
    line?: string;
    routine?: string;
}

function isServerMessage(e: Error) : e is ServerMessage{
    return e.name == "notice" || (e.name == "error" && 'severity' in e)
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

type BlockData = QuestionBlock | TextReplyBlock | PgResultBlock | ClientErrorBlock;

interface QuestionBlock {
    id: number;
    when: Date;
    type: "question";
    value: string;
}

interface TextReplyBlock {
    id: number;
    when: Date;
    type: "text";
    subtype: "notice" | "error";
    value: string;
}

interface PgResultBlock {
    id: number;
    when: Date;
    type: "resultTable";
    result: pg.QueryResult;
}

interface ClientErrorBlock {
    id: number;
    when: Date;
    type: "clientError";
    error: Error;
}

var TS = (props: {val: Date}) : JSX.Element => <time dateTime={props.val.toISOString()}>{props.val.toLocaleTimeString()}</time>

class QuestionBlockView extends React.PureComponent<QuestionBlock> {
    render() {
        return <div className="text question">
            [<TS val={this.props.when}/>] &gt; {this.props.value}
        </div>
    }
}

class TextReplyBlockView extends React.PureComponent<TextReplyBlock> {
    render() {
        return <div className={`text ${this.props.type}`}>
            [<TS val={this.props.when}/>] {this.props.value}
        </div>
    }
}

function TableBlockRow(props: {header: pg.FieldDef[], data: any[]}) {
    if(props.data.length == 0) {
        return <tr><th/></tr>;
    }
    else if(props.data[0] instanceof Array) {
        return <tr>
            <th/>
            {props.data.map(i => <td>{i.toString()}</td>)}
        </tr>;
    }
    else {
        return <tr>
            <th/>
            {props.header.map(i => <td>{props.data[i.name].toString()}</td>)}
        </tr>;
    }
}

class TableBlockView extends React.PureComponent<PgResultBlock> {
    render() {
        let tab : JSX.Element | undefined;
        if(this.props.result.rows.length > 0) {
            let header = <tr>
                <th/>
                {this.props.result.fields.map(i => <th>
                    {i.name}
                </th>)}
            </tr>;
            tab = <table>
                <thead>
                    {header}
                </thead>
                <tbody>
                    {this.props.result.rows.map(i => <TableBlockRow header={this.props.result.fields} data={i}/>)}
                </tbody>
            </table>;
        }

        return <div className="table">
            [<TS val={this.props.when}/>] {this.props.result.command}: {this.props.result.rowCount} row{this.props.result.rowCount != 1 ? "s" : ""} affected.
            {tab}
        </div>
    }
}

class ClientErrorView extends React.PureComponent<ClientErrorBlock> {
    render() {
        return <div className="clientError">
            <TS val={this.props.when}/> <span className="message">{this.props.error.message}</span>
            <pre>{this.props.error.stack}</pre>
        </div>
    }
}

interface ScrollbackData {
    items: BlockData[];
}

class ScrollbackView extends React.Component<ScrollbackData> {
    static blockTypes : { [s: string]: typeof React.Component} = {
        question: QuestionBlockView,
        text: TextReplyBlockView,
        resultTable: TableBlockView,
        clientError: ClientErrorView
    };
    
    render() {
        let things = [];
        if(this.props.items.length == 0) {
            things = ["Nothing"];
        }
        else {
            things = this.props.items.map(i => {
                let Block : typeof React.Component | undefined = ScrollbackView.blockTypes[i.type];
                if(!Block) { return <div className="error">[Unknown block type]</div>; }
                return React.createElement(Block, {...i, key: i.id.toString()});
            });
        }
        return <div className="scrollback">{things}</div>;
    }
}

interface InputAreaProps {
    onSubmit : (data: string) => void;
}

interface InputAreaState {
    queryText: string;
}

class InputArea extends React.Component<InputAreaProps, InputAreaState> {
    handleChange = (event) => this.setState({queryText: event.target.value});
    handleSubmit = () => this.props.onSubmit(this.state.queryText);

    render() {
        return <div className="input">
            <textarea onChange={this.handleChange}/>
            <button onClick={this.handleSubmit}>Run</button>
        </div>
    }
}

interface ReplViewState {
    scrollbackItems: BlockData[];
}

interface ReplViewProps {
    connection: pg.ClientBase;
}

export class REPL extends React.Component<ReplViewProps, ReplViewState> {
    lastId : number;

    constructor(props: ReplViewProps) {
        super(props);
        this.state = {
            scrollbackItems: []
        };
        this.lastId = 0;
    }

    componentDidMount() {
    }

    componentWillUnmount() {
    }

    onSubmitInput = async (input: string) => {
        this.appendBlock({
            when: new Date(),
            type: "question",
            value: input
        });
        try {
            let res = await this.props.connection.query(input);
            this.appendBlock({
                when: new Date(),
                type: "resultTable",
                result: res
            });

        }
        catch(e) {
            if(isServerMessage(e)) {
                this.appendBlock({
                    when: new Date(),
                    type: "text",
                    subtype: e.name == "notice" ? "notice" : "error",
                    value: util.inspect(e)
                });
            }
            else {
                this.appendBlock({
                    when: new Date(),
                    type: "clientError",
                    error: e
                });
            }
        }
    }

    onNotice = async (e: any) => {
        this.appendBlock({
            when: new Date(),
            type: "text",
            subtype: "notice",
            value: JSON.stringify(e)
        });
    }

    onError = async (e: any) => {
        this.appendBlock({
            when: new Date(),
            type: "text",
            subtype: "error",
            value: JSON.stringify(e)
        });
    }

    appendBlock(bd: DistributiveOmit<BlockData, "id">) {
        let block : BlockData = Object.assign(bd, {id: this.lastId++});
        this.setState((state, props) => ({scrollbackItems : [...state.scrollbackItems, block]}));
    }

    render() {
        return <div className="repl">
            <ScrollbackView items={this.state.scrollbackItems}/>
            <InputArea onSubmit={this.onSubmitInput}/>
        </div>
    }
}