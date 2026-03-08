import React from 'react';
import { Dropdown } from 'semantic-ui-react';
import PropTypes from 'prop-types';
import './OutputFormat.css';

const OutputFormat = ({ filetype, filetypes, onFiletypeChanged }) => {
    const changeHandler = onFiletypeChanged ? (event, data) => onFiletypeChanged(data.value) : undefined;

    return <Dropdown
        id='select-output-format'
        className='OutputFormat OutputFormatSelect'
        placeholder='Format'
        aria-label='Output format'
        options={filetypes.map((value) => ({
            key: value,
            value,
            text: value.toUpperCase(),
        }))}
        value={filetype}
        onChange={changeHandler}
        selection
    />;
};

OutputFormat.propTypes = {
    filetype: PropTypes.string.isRequired,
    filetypes: PropTypes.arrayOf(PropTypes.string),
    onFiletypeChanged: PropTypes.func,
};

OutputFormat.defaultProps = {
    filetypes: ['svg'],
    onFiletypeChanged: undefined,
};

export default OutputFormat;
