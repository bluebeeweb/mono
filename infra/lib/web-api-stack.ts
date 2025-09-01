import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';

export class WebApiStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // 1) Lambda (NestJS) — bundle from TypeScript entry
        const apiFn = new NodejsFunction(this, 'ApiLambda', {
            entry: path.resolve(__dirname, '../../apps/api/src/lambda.ts'),
            handler: 'handler',
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 1024,
            timeout: cdk.Duration.seconds(15),
            bundling: {
                minify: true,
                sourcesContent: false,
                externalModules: [ 'aws-sdk' ] // (v2 is in runtime; avoid bundling if you use it)
            },
                environment: {
                NODE_OPTIONS: '--enable-source-maps'
            }
        });


        // 2) API Gateway (REST) -> Lambda proxy
        const api = new apigw.LambdaRestApi(this, 'ApiGateway', {
            handler: apiFn,
            proxy: true,
            deployOptions: { stageName: 'prod' }
        });


        // Helper: extract domain for CloudFront origin (e.g., abc.execute-api.us-east-1.amazonaws.com)
        const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', api.url));


        // 3) S3 bucket for Angular app
        const siteBucket = new s3.Bucket(this, 'SiteBucket', {
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            versioned: true
        });


        // 4) CloudFront distribution
        const oai = new cloudfront.OriginAccessIdentity(this, 'SiteOAI');
        siteBucket.grantRead(oai);


        const distribution = new cloudfront.Distribution(this, 'Distribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new origins.S3Origin(siteBucket, { originAccessIdentity: oai }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
            },
            additionalBehaviors: {
                'api/*': {
                    origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
                }
            },
            errorResponses: [
                { httpStatus: 403, responsePagePath: '/index.html', responseHttpStatus: 200, ttl: cdk.Duration.seconds(0) },
                { httpStatus: 404, responsePagePath: '/index.html', responseHttpStatus: 200, ttl: cdk.Duration.seconds(0) }
            ]
        });


        // 5) Deploy Angular build to S3 and invalidate CloudFront
        new s3deploy.BucketDeployment(this, 'DeployWeb', {
            sources: [s3deploy.Source.asset(path.resolve(__dirname, '../../apps/web/dist'))],
            destinationBucket: siteBucket,
            distribution,
            distributionPaths: ['/*']
        });


        // 6) Outputs
        new cdk.CfnOutput(this, 'CloudFrontURL', { value: `https://${distribution.domainName}` });
        new cdk.CfnOutput(this, 'ApiURL', { value: api.url });
    }
}