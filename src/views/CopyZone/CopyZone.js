import React from 'react';
import { Divider, Form, Segment } from 'semantic-ui-react'
import CopyField from '../CopyField'
import './CopyZone.css'

const CopyZone = () => {
    return <Segment className='CopyZone' basic>
    <Divider/>
        <Form>
            <Form.Field>
                <label>Render url</label>
                <CopyField scope='image' />
            </Form.Field>
            <Form.Field>
                <label>Edit url</label>
                <CopyField scope='edit' />
            </Form.Field>
            <Form.Field>
                <label>Markdown snippet</label>
                <CopyField scope='markdown' />
            </Form.Field>
            <Form.Field>
                <label>Markdown snippet with source comment</label>
                <CopyField scope='markdownsource' />
            </Form.Field>
        </Form>
    </Segment>
}

CopyZone.propTypes = {
}

export default CopyZone;
