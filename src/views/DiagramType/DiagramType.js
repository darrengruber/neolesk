import React from 'react';
import PropTypes from 'prop-types';
import './DiagramType.css'

const DiagramType = ({ diagramTypes, diagramType, onDiagramTypeChanged }) => {
    if (!diagramTypes) {
        diagramTypes = {}
    }
    const changeHandler = onDiagramTypeChanged ? (event) => onDiagramTypeChanged(event.target.value) : undefined;

    return <label className='AppSelectField DiagramTypeField'>
        <span className='AppSelectFieldLabel'>Diagram type</span>
        <select
            id='select-diagram'
            className='AppSelectControl DiagramTypeSelect'
            aria-label='Diagram'
            value={diagramType}
            onChange={changeHandler}
        >
            {Object.keys(diagramTypes).map((item) => <option key={item} value={item}>{diagramTypes[item].name}</option>)}
        </select>
    </label>
}

DiagramType.propTypes = {
    diagramTypes: PropTypes.objectOf(PropTypes.shape({ name: PropTypes.string })),
    diagramType: PropTypes.string.isRequired,
    onDiagramTypeChanged: PropTypes.func,
};

export default DiagramType;
