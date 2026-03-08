import React from 'react';
import './SubTitle.css'

const version = `${__APP_VERSION__}-${__GIT_HASH__}`;

const SubTitle = () => {
    return <div className='SubTitle' basic="true">
        <div>Edit <b>diagrams</b> from <b>textual</b> descriptions with <a href='https://kroki.io'>Kroki</a>.</div>
        <div className='SubTitleSmall'>Project: <a href='https://github.com/webgiss/niolesk/'>github.com/webgiss/niolesk</a> · Build {version}</div>
    </div>
}

export default SubTitle;
