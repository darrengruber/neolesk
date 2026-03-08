import React from 'react';
import PropTypes from 'prop-types';
import './OutputFormat.css';

const OutputFormat = ({ filetype, filetypes, onFiletypeChanged }) => {
    return <div className='OutputFormatGroup' aria-label='Supported output types'>
        {filetypes.map((value) => <button
            key={value}
            type='button'
            className={`OutputFormatButton${value === filetype ? ' active' : ''}`}
            onClick={() => onFiletypeChanged && onFiletypeChanged(value)}
        >
            {value.toUpperCase()}
        </button>)}
    </div>;
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
