import React from 'react';
import CopyField from '../CopyField'
import './CopyZone.css'

const CopyZone = () => {
    return <div className='CopyZone'>
        <div className='CopyZoneGrid'>
            <div className='CopyZoneField'>
                <label>Render URL</label>
                <CopyField scope='image' />
            </div>
            <div className='CopyZoneField'>
                <label>Edit URL</label>
                <CopyField scope='edit' />
            </div>
            <div className='CopyZoneField'>
                <label>Markdown snippet</label>
                <CopyField scope='markdown' />
            </div>
            <div className='CopyZoneField'>
                <label>Markdown snippet with source comment</label>
                <CopyField scope='markdownsource' />
            </div>
        </div>
    </div>
}

CopyZone.propTypes = {
}

export default CopyZone;
