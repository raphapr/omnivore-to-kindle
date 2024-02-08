import epub from "epub-gen-memory";
import { gql, GraphQLClient } from "graphql-request";
import sanitizeHtml from "sanitize-html";
import nodemailer from "nodemailer";
import { homedir } from 'os';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';

dotenv.config();

const OMNIVORE_ENDPOINT: string = "https://api-prod.omnivore.app/api/graphql";
const OMNIVORE_API_KEY: string = process.env.OMNIVORE_API_KEY || '';
const KINDLE_EMAIL_ADDRESS: string = process.env.KINDLE_EMAIL_ADDRESS || '';
const GMAIL_USER: string = process.env.GMAIL_USER || '';
const GMAIL_APP_PASSWORD: string = process.env.GMAIL_APP_PASSWORD || '';

const currentDate: string = new Date().toISOString().split("T")[0];

const config = {
  title: "Omnivore Articles",
  author: "Omnivore",
  cover: "https://cdn.discordapp.com/attachments/779248028824764426/1149996974234423346/cover.jpg",
  description: "Articles from Omnivore",
  addLabelsInContent: false,
  addArticleLinkInContent: true,
  allowImages: true,
  attachmentPath: `${homedir()}/Downloads/${currentDate}.epub`,
  maxArticleCount: 5,
  ignoredLabels: ["pdf"],
  ignoredLinks: ["https://www.youtu", "https://youtu"],
};

const currentVersion: string = "v0.2.0";

console.log(`ℹ  Omnivore EPUB ${currentVersion}`);
console.log("ℹ️ Homepage: https://github.com/agrmohit/omnivore-epub");

if (!OMNIVORE_API_KEY) {
  console.log("❌ Omnivore API token not set");
  console.log(
    "❌ Get a token following instructions on: https://docs.omnivore.app/integrations/api.html#getting-an-api-token",
  );
  console.log("❌ When you have a token, insert it as value for 'token' field in 'config.json' file");
  process.exit(1);
}

const graphQLClient = new GraphQLClient(OMNIVORE_ENDPOINT, {
  headers: {
    authorization: OMNIVORE_API_KEY,
  },
});

async function sendEmail(attachmentPath: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    }
  });

  const mailOptions = {
    from: GMAIL_USER,
    to: KINDLE_EMAIL_ADDRESS,
    subject: `Omnivore Latest Articles for ${currentDate}`,
    text: "Please see your epub attached",
    attachments: [{ path: attachmentPath }]
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
}

async function checkForUpdates() {
  const response = await fetch("https://api.github.com/repos/agrmohit/omnivore-epub/tags");
  const tags = await response.json();

  if (tags[0].name !== currentVersion) {
    console.log("ℹ  New update available");
    console.log(`ℹ  ${currentVersion} --> ${tags[0].name}`);
  }
}

async function getUnreadArticles(): Promise<any[]> {
  const query = gql`
    {
      search(first: ${config.maxArticleCount}) {
        ... on SearchSuccess {
          edges {
            cursor
            node {
              title
              slug
              description
              url
              savedAt
              language
              subscription
              isArchived
              author
              labels {
                name
              }
            }
          }
        }
      }
    }
  `;

  const data = await graphQLClient.request(query);

  return data.search.edges.map((e: any) => {
    if (e.node.labels) {
      e.node.labelsArray = e.node.labels.map((label: any) => label.name);
    }
    return e.node;
  });
}

async function getArticle(slug: string): Promise<any> {
  const query = gql`{
    article (username: "anonymous", slug: "${slug}") {
      ... on ArticleSuccess {
        article {
          id, slug, url, content
        }
      }
    }
  }`;

  const data = await graphQLClient.request(query);

  let allowedTags: string[];
  if (config.allowImages) {
    allowedTags = sanitizeHtml.defaults.allowedTags.concat(["img"]);
  } else {
    allowedTags = sanitizeHtml.defaults.allowedTags.concat();
  }

  if (!data) {
    return {
      title: 'None..',
      content: ''
    };
  }

  const sanitizedArticle = sanitizeHtml(data.article.article.content, {
    allowedTags: allowedTags,
  });

  return {
    ...data.article.article,
    content: sanitizedArticle,
  };
}

async function makeMagazine(): Promise<void> {
  console.log("〰️ getting article list");
  const articles = await getUnreadArticles();
  console.log("🤖 done");

  const chapters = [];

  for (const article of articles) {
    if (!article.isArchived) {
      console.log(`🌐 fetching ${article.title}`);
      let content = (await getArticle(article.slug)).content;

      if (article.labelsArray) {
        if (
          config.ignoredLinks.some((url: string) => article.url.includes(url))
          || article.labelsArray.find((label: string) => config.ignoredLabels.includes(label))
        ) {
          console.log("⚠️ article skipped");
          continue;
        }
        if (config.addLabelsInContent) {
          content = `<b>Labels: ${article.labelsArray.join(", ")}</b>` + content;
        }
      }
      if (config.addArticleLinkInContent) {
        content = `<a href="${article.url}">Link to Article</a><br><br>` + content;
      }

      chapters.push({
        title: article.title,
        author: article.author ?? "Omnivore",
        content: content,
        filename: article.slug,
      });

      console.log(`✅ done`);
    }
  }
  console.log('Done fetching content for articles... Writing ePub file... Please wait.');

  const fileBuffer = await epub(
    {
      title: config.title,
      author: config.author,
      cover: config.cover,
      description: config.description,
      ignoreFailedDownloads: true,
    },
    chapters,
  );

  console.log("📚 Successfully created ebook");
  fs.writeFile(config.attachmentPath, fileBuffer, (err) => {
    if (err) {
      console.error('Error writing epub file:', err);
    } else {
      console.log('Epub file written successfully.');
      sendEmail(config.attachmentPath);
    }
  });
}

checkForUpdates();
makeMagazine();
