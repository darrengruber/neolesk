import React from 'react';
import MonacoEditor from '@monaco-editor/react';
import PropTypes from 'prop-types';
import './Editor.css'

class Editor extends React.Component {
    get shouldUpdate() {
        return this._shouldUpdate === undefined ? true : this._shouldUpdate
    }

    set shouldUpdate(value) {
        this._shouldUpdate = value;
    }

    shouldComponentUpdate(nextProps) {
        if (this._editor) {
            const editorText = this._editor.getValue();
            const nextPropsText = nextProps.text;
            const wrapChanged = nextProps.wrapEnabled !== this.props.wrapEnabled;

            if (wrapChanged) {
                this.shouldUpdate = true;
            } else if (nextPropsText === editorText) {
                if (nextProps.height !== this.props.height) {
                    this.shouldUpdate = true;
                } else {
                    this.shouldUpdate = false;
                }
            } else {
                this.shouldUpdate = true;
            }
            return this.shouldUpdate;
        } else {
            return true;
        }
    }

    componentDidUpdate(prevProps) {
        if (this._editor && prevProps.wrapEnabled !== this.props.wrapEnabled) {
            this._editor.updateOptions({
                wordWrap: this.props.wrapEnabled ? 'on' : 'off',
                wrappingIndent: 'indent',
            });
        }
    }

    render() {
        const { text, language, onTextChanged, wrapEnabled } = this.props;
        const { shouldUpdate } = this;

        return <div className='Editor'>
            <MonacoEditor
                className='MonacoEditor'
                onMount={(editor) => {
                    this._editor = editor;
                }}
                language={language || "plaintext"}
                onChange={(value) => onTextChanged(value || '')}
                value={shouldUpdate ? text : undefined}
                options={{
                    theme: 'vs',
                    automaticLayout: true,
                    folding: true,
                    foldingStrategy: 'indentation',
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineHeight: 22,
                    padding: { top: 18, bottom: 18 },
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    wordWrap: wrapEnabled ? 'on' : 'off',
                    wrappingIndent: 'indent',
                }}
                height='100%'
            />
        </div>
    }
}

Editor.defaultProps = {
    wrapEnabled: true,
};

Editor.propTypes = {
    text: PropTypes.string,
    language: PropTypes.string,
    onTextChanged: PropTypes.func.isRequired,
    height: PropTypes.number,
    wrapEnabled: PropTypes.bool,
};

export default Editor;
