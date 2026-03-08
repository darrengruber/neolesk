import React from 'react';
import './RenderUrl.css'

const RenderUrl = ({ renderUrl, renderUrlChanged }) => {
    const changeHandler = renderUrlChanged ? (event) => renderUrlChanged(event.target.value) : undefined;

    return <label className='AppTextField RenderUrlField'>
        <span className='AppTextFieldLabel'>Kroki engine</span>
        <input
            className='AppTextControl RenderUrlInput code'
            value={renderUrl}
            onChange={changeHandler}
            placeholder='https://kroki.io/'
            aria-label='Render URL engine'
        />
    </label>
}

export default RenderUrl;
