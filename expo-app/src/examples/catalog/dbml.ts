import { defineExamples, lines } from '../define';

const dbml = defineExamples([
    {
        diagramType: "dbml",
        default: true,
        description: "Default",
        title: "DBML",
        doc: "https://www.dbml.org/docs/",
        keywords: ["diagram", "SQL", "entity", "relation", "schema"],
        source: lines([
            "Table users {",
            "  id integer",
            "  username varchar",
            "  role varchar",
            "  created_at timestamp",
            "}",
            "",
            "Table posts {",
            "  id integer [primary key]",
            "  title varchar",
            "  body text [note: 'Content of the post']",
            "  user_id integer",
            "  status post_status",
            "  created_at timestamp",
            "}",
            "",
            "Enum post_status {",
            "  draft",
            "  published",
            "  private [note: 'visible via URL only']",
            "}",
            "",
            "Ref: posts.user_id > users.id // many-to-one",
        ]),
    },
]);

export default dbml;
